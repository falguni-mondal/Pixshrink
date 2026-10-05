// Public API for local processing. Uses a Web Worker when the browser supports
// Worker + OffscreenCanvas, and quietly falls back to the main thread otherwise.
import { canEncode, compressImage, renderThumbnail } from "./encodeCore";

export const canEncodeLocally = canEncode;

let worker = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (
    workerBroken ||
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    return null;
  }
  if (worker) return worker;

  try {
    worker = new Worker(new URL("./compress.worker.js", import.meta.url));

    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      if (data.ok) task.resolve(data.result);
      else task.reject(new Error(data.error));
    };

    worker.onerror = () => {
      // The worker failed to load or crashed: retry pending tasks on the main thread
      // and don't try the worker again this session.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const task of pending.values()) task.reject(new Error("WORKER_FAILED"));
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

// Returns a promise, or null when no worker is available.
function runInWorker(type, payload) {
  const w = getWorker();
  if (!w) return null;
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...payload });
  });
}

/** @returns {Promise<{ blob: Blob, format: string }>} */
export async function compressLocally(file, opts) {
  try {
    const job = runInWorker("compress", { file, opts });
    if (job) return await job;
  } catch (error) {
    if (error.message !== "WORKER_FAILED") throw error;
  }
  return compressImage(file, opts);
}

/** @returns {Promise<Blob>} a small square WebP preview */
export async function thumbnailLocally(file, size = 160) {
  try {
    const job = runInWorker("thumb", { file, size });
    if (job) return await job;
  } catch (error) {
    if (error.message !== "WORKER_FAILED") throw error;
  }
  return renderThumbnail(file, size);
}
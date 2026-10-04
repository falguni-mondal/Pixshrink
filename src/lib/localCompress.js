// Public API for local compression. Uses a Web Worker when the browser supports
// Worker + OffscreenCanvas, and quietly falls back to the main thread otherwise.
import { canEncode, compressImage } from "./encodeCore";

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
      if (data.ok) task.resolve({ blob: data.blob, format: data.format });
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

/**
 * @returns {Promise<{ blob: Blob, format: string }>}
 */
export async function compressLocally(file, opts) {
  const w = getWorker();
  if (!w) return compressImage(file, opts);

  try {
    return await new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, file, opts });
    });
  } catch (error) {
    if (error.message === "WORKER_FAILED") return compressImage(file, opts);
    throw error;
  }
}
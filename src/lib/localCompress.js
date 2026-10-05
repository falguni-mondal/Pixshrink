// Public API for local processing, backed by a pool of Web Workers.
//
// Design:
//  - Each worker runs one job at a time. Parallelism comes from having several workers.
//  - Two queues: "compress" jobs always run before "thumb" jobs, so previews never slow
//    down a running batch.
//  - Workers are created on demand (up to getWorkerPoolSize()) and terminated after
//    IDLE_MS without work, which frees their memory (including the HEIC WASM decoder).
//
// Failure handling:
//  - A job that takes too long fails on its own (code "TIMEOUT"). Only its worker is
//    replaced, because it may be stuck. Other jobs are not affected.
//  - If a worker crashes, its job is retried on a fresh worker, at most MAX_ATTEMPTS
//    times in total, then fails with code "WORKER_CRASHED". A crash usually means
//    out-of-memory, so we don't retry on the main thread.
//  - If no worker has ever answered, workers are treated as unsupported or unable to
//    load, and every job falls back to the main thread (code "WORKER_FAILED").
import { canEncode, compressImage, renderThumbnail } from "./encodeCore";
import { isHeicFile } from "./fileTypes";
import { getWorkerPoolSize } from "./device";

export const canEncodeLocally = canEncode;

const TIMEOUT_MS = { compress: 90_000, thumb: 45_000 };
const HEIC_TIMEOUT_FACTOR = 2; // a worker's first HEIC job also downloads the WASM decoder
const MAX_ATTEMPTS = 2;
const IDLE_MS = 30_000;

const slots = new Set(); // { worker, task, idleTimer }
const queues = { compress: [], thumb: [] };
let workerBroken = false; // true only if workers never worked at all
let everResponded = false;
let nextId = 1;

const makeError = (message, code) => Object.assign(new Error(message), { code });

function canUseWorkers() {
  return !workerBroken && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

/* ----------------------------- slot lifecycle ----------------------------- */

function removeSlot(slot) {
  clearTimeout(slot.idleTimer);
  if (slot.task) clearTimeout(slot.task.timer);
  slots.delete(slot);
  slot.worker.terminate();
}

// Marks the slot's job as done and starts its idle countdown.
function release(slot) {
  if (slot.task) clearTimeout(slot.task.timer);
  slot.task = null;
  clearTimeout(slot.idleTimer);
  slot.idleTimer = setTimeout(() => {
    if (!slot.task && slots.has(slot)) removeSlot(slot);
  }, IDLE_MS);
}

// Nothing ever worked: give up on workers and let every job use the main thread.
function failEverything() {
  workerBroken = true;
  const running = [];
  for (const slot of Array.from(slots)) {
    if (slot.task) running.push(slot.task);
    removeSlot(slot);
  }
  const waiting = [...queues.compress.splice(0), ...queues.thumb.splice(0)];
  for (const task of [...running, ...waiting]) {
    task.reject(makeError("Worker failed to start", "WORKER_FAILED"));
  }
}

function handleCrash(slot) {
  const task = slot.task;
  removeSlot(slot);
  slot.task = null;

  if (!everResponded) {
    // The script never loaded. Put the job back so failEverything() rejects it too.
    if (task) queues[task.type].unshift(task);
    failEverything();
    return;
  }

  if (task) {
    task.attempts++;
    if (task.attempts >= MAX_ATTEMPTS) {
      task.reject(
        makeError(
          "The image processor crashed, usually because the image is too large for this device",
          "WORKER_CRASHED"
        )
      );
    } else {
      queues[task.type].unshift(task); // retry first, on a fresh worker
    }
  }
  dispatch();
}

function onTimeout(slot, task) {
  if (slot.task !== task) return; // already finished
  removeSlot(slot); // a hung worker can't be trusted; only this job is affected
  slot.task = null;
  task.reject(
    makeError(
      task.type === "thumb"
        ? "Preview took too long to generate"
        : "Compression took too long and was stopped",
      "TIMEOUT"
    )
  );
  dispatch();
}

function createSlot() {
  let worker;
  try {
    // Keep this a classic worker (no { type: "module" }): heicDecode.js uses importScripts.
    worker = new Worker(new URL("./compress.worker.js", import.meta.url));
  } catch {
    failEverything();
    return null;
  }

  const slot = { worker, task: null, idleTimer: null };

  worker.onmessage = ({ data }) => {
    if (!slots.has(slot)) return; // stale message from a terminated worker
    everResponded = true;
    const task = slot.task;
    if (!task || task.id !== data.id) return;
    release(slot);
    if (data.ok) task.resolve(data.result);
    else task.reject(new Error(data.error));
    dispatch();
  };

  // Script failed to load, or an uncaught error crashed the worker.
  worker.onerror = (event) => {
    event?.preventDefault?.();
    if (slots.has(slot)) handleCrash(slot);
  };

  // A message could not be deserialized, so the job can't complete.
  worker.onmessageerror = () => {
    if (slots.has(slot)) handleCrash(slot);
  };

  slots.add(slot);
  return slot;
}

/* -------------------------------- scheduling ------------------------------ */

function run(slot, task) {
  clearTimeout(slot.idleTimer);
  slot.task = task;

  const base = TIMEOUT_MS[task.type] ?? TIMEOUT_MS.compress;
  const ms = isHeicFile(task.payload.file) ? base * HEIC_TIMEOUT_FACTOR : base;
  task.timer = setTimeout(() => onTimeout(slot, task), ms);

  try {
    slot.worker.postMessage({ id: task.id, type: task.type, ...task.payload });
  } catch (error) {
    // e.g. DataCloneError: the job itself is bad, not the worker.
    release(slot);
    task.reject(error);
  }
}

function dispatch() {
  if (workerBroken) return;
  const max = getWorkerPoolSize();

  for (;;) {
    const type = queues.compress.length ? "compress" : queues.thumb.length ? "thumb" : null;
    if (!type) return;

    let slot = null;
    for (const s of slots) {
      if (!s.task) { slot = s; break; }
    }
    if (!slot && slots.size < max) slot = createSlot();
    if (!slot || workerBroken) return; // pool is full (job stays queued) or workers unusable

    run(slot, queues[type].shift());
  }
}

// Returns a promise, or null when workers can't be used at all.
function runInWorker(type, payload) {
  if (!canUseWorkers()) return null;
  return new Promise((resolve, reject) => {
    queues[type].push({ id: nextId++, type, payload, resolve, reject, attempts: 0, timer: null });
    dispatch();
  });
}

async function runLocal(type, payload, mainThreadFallback) {
  const job = runInWorker(type, payload);
  if (job) {
    try {
      return await job;
    } catch (error) {
      if (error?.code !== "WORKER_FAILED") throw error;
    }
  }
  return mainThreadFallback();
}

/** @returns {Promise<{ blob: Blob, format: string }>} */
export function compressLocally(file, opts) {
  return runLocal("compress", { file, opts }, () => compressImage(file, opts));
}

/** @returns {Promise<Blob>} a small square JPEG preview */
export function thumbnailLocally(file, size = 160) {
  return runLocal("thumb", { file, size }, () => renderThumbnail(file, size));
}
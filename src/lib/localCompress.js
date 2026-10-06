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
//    replaced, because it may be stuck. Other jobs are not affected. The limit scales with
//    the work (AVIF output size and Max Limit passes), because a slow-but-working AVIF
//    encode must not be killed. A single-threaded WASM encode can't send heartbeats, so
//    "slow" and "stuck" can't be told apart: the ceiling is deliberately very high.
//  - If a worker crashes, its job is retried on a fresh worker, at most maxAttempts()
//    times in total (more on phones), then fails with code "WORKER_CRASHED". A crash
//    usually means out-of-memory, so we don't retry on the main thread.
//  - If the first two workers of the session both die before ever answering, workers are
//    treated as unsupported or unable to load, and every job falls back to the main thread
//    (code "WORKER_FAILED"). One early crash alone is not enough: it may just be a heavy
//    first file.
//  - On phones a worker is replaced after a few HEIC jobs, because the libheif WASM heap
//    only ever grows and a long batch would otherwise end with a bloated worker.
import { canEncode, compressImage, renderThumbnail } from "./encodeCore";
import { isHeicFile } from "./fileTypes";
import { getWorkerPoolSize, isMobileDevice } from "./device";

export const canEncodeLocally = canEncode;

const TIMEOUT_MS = { compress: 90_000, thumb: 45_000 };
const HEIC_TIMEOUT_FACTOR = 2; // a worker's first HEIC job also downloads the WASM decoder
const TIMEOUT_CEILING_MS = 30 * 60_000; // nothing is allowed to run longer than this
// Extra time per output megapixel per AVIF encode pass (T: tune after measuring).
const AVIF_SECONDS_PER_MP_PASS = { desktop: 8, mobile: 25 };
const DEFAULT_AVIF_PASSES = 6; // same default as encodeCore.js
const MAX_ATTEMPTS = 2;
const MOBILE_MAX_ATTEMPTS = 3; // a fresh worker often fixes a memory-related crash
const MAX_EARLY_CRASHES = 2; // crashes before any worker ever answered
const HEIC_JOBS_BEFORE_RECYCLE = 6; // phones only (T)
const IDLE_MS = 30_000;

const slots = new Set(); // { worker, task, idleTimer, heicJobs }
const queues = { compress: [], thumb: [] };
let workerBroken = false; // true only if workers never worked at all
let everResponded = false;
let earlyCrashes = 0;
let nextId = 1;

const maxAttempts = () => (isMobileDevice() ? MOBILE_MAX_ATTEMPTS : MAX_ATTEMPTS);

// Time a job may take before it is stopped.
function timeoutFor(task) {
  const base = TIMEOUT_MS[task.type] ?? TIMEOUT_MS.compress;
  let ms = isHeicFile(task.payload.file) ? base * HEIC_TIMEOUT_FACTOR : base;

  const opts = task.payload.opts;
  if (task.type === "compress" && opts?.format === "avif") {
    // The source size isn't known here, so assume a tall 3:4 photo at the target width.
    // That over-estimates for most images, which is the safe direction for a timeout.
    const width = Number(opts.width) > 0 ? Number(opts.width) : 3840;
    const outMP = (width * width * (4 / 3)) / 1e6;
    // 1 encode, plus (search passes + 1 final encode) when a Max Limit is set.
    const passes =
      1 + (Number(opts.maxKB) > 0 ? (Number(opts.avifMaxPasses) || DEFAULT_AVIF_PASSES) + 1 : 0);
    const perMP = AVIF_SECONDS_PER_MP_PASS[isMobileDevice() ? "mobile" : "desktop"];
    ms += outMP * passes * perMP * 1000;
  }
  return Math.min(ms, TIMEOUT_CEILING_MS);
}

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
    // No worker has answered yet. Put the job back either way.
    if (task) queues[task.type].unshift(task);
    earlyCrashes++;
    // Two silent deaths in a row mean the script can't load: give up on workers.
    // A single one may just be a heavy first file, so try a fresh worker once.
    if (earlyCrashes >= MAX_EARLY_CRASHES) failEverything();
    else dispatch();
    return;
  }

  if (task) {
    task.attempts++;
    if (task.attempts >= maxAttempts()) {
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
        : "The image processor stopped responding and was stopped",
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

  const slot = { worker, task: null, idleTimer: null, heicJobs: 0 };

  worker.onmessage = ({ data }) => {
    if (!slots.has(slot)) return; // stale message from a terminated worker
    everResponded = true;
    const task = slot.task;
    if (!task || task.id !== data.id) return;
    release(slot);
    if (isHeicFile(task.payload.file)) slot.heicJobs++;
    if (data.ok) task.resolve(data.result);
    else task.reject(new Error(data.error));
    // Phones: replace the worker after a few HEIC jobs so its WASM heap starts fresh.
    // Safe here because the job is already finished, so nothing is lost.
    if (isMobileDevice() && slot.heicJobs >= HEIC_JOBS_BEFORE_RECYCLE) removeSlot(slot);
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

  task.timer = setTimeout(() => onTimeout(slot, task), timeoutFor(task));

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
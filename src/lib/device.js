// Shared device helpers. Safe to import anywhere: every function guards against
// running on the server, where `window` and `navigator` don't exist.

export const MAX_MOBILE_FILES = 50;

const MB = 1024 * 1024;
const MOBILE_PART_LIMIT = 40 * MB;
const DESKTOP_PART_LIMIT = 250 * MB;

let mobileCache = null;

function detectMobile() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  // Chromium exposes this directly and it is the most reliable signal when present.
  const uaMobile = navigator.userAgentData?.mobile;
  if (typeof uaMobile === "boolean" && uaMobile) return true;

  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;

  // iPadOS 13+ reports a Mac user agent but, unlike a real Mac, has a touch screen.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;

  // A coarse *primary* pointer means a touch-first device. Touchscreen laptops report
  // a fine primary pointer, so they are not misdetected.
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
  } catch {
    // matchMedia unavailable: treat as desktop
  }
  return false;
}

export function isMobileDevice() {
  if (typeof window === "undefined") return false; // don't cache a server-side answer
  if (mobileCache === null) mobileCache = detectMobile();
  return mobileCache;
}

/** Bytes after which a new zip part is started. */
export function getPartLimit() {
  return isMobileDevice() ? MOBILE_PART_LIMIT : DESKTOP_PART_LIMIT;
}

/** How many Web Workers the local engine may run at once. */
export function getWorkerPoolSize() {
  if (typeof navigator === "undefined" || isMobileDevice()) return 1;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : 4;
  const memoryCap = memory <= 4 ? 2 : 4; // each worker can hold a decoded image (and the HEIC decoder)
  return Math.max(1, Math.min(memoryCap, cores - 1)); // leave one core for the page
}

/**
 * How many files are processed at the same time.
 * "local": matches the worker pool, since extra jobs would only wait in the queue.
 * "imagekit": network-bound, so a few requests in parallel are fine.
 */
export function getConcurrency(engine = "local") {
  if (isMobileDevice()) return 1;
  if (engine === "imagekit") return 4;
  return getWorkerPoolSize();
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
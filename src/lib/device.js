// Shared device helpers. Safe to import anywhere: every function guards against
// running on the server, where `window` and `navigator` don't exist.
//
// IMPORTANT: these helpers are for the MAIN THREAD only. Inside a Web Worker there is no
// `window`, so isMobileDevice() would wrongly answer false. Anything a worker needs
// (for example the AVIF pass cap) must be read here and passed to it through the job options.

export const MAX_MOBILE_FILES = 50;

// Mobile batch limits by workload (T = starting values, tune after measuring real phones).
export const MOBILE_FILE_LIMITS = {
  standard: MAX_MOBILE_FILES, // no HEIC-on-Android, no AVIF
  heavy: 25, // Android HEIC, or any AVIF
  heaviest: 10, // Android HEIC converted to AVIF (both costs at once)
};
export const MOBILE_AVIF_MAX_PASSES = 3; // (T) Max Limit search passes on phones
export const DESKTOP_AVIF_MAX_PASSES = 6; // same value encodeCore.js uses today
export const MOBILE_AVIF_MAX_MEGAPIXELS = 8; // (T) AVIF output above this fails on phones

const MB = 1024 * 1024;
const MOBILE_PART_LIMIT = 40 * MB;
const DESKTOP_PART_LIMIT = 250 * MB;

export const MOBILE_MAX_BATCH_MB = 400; // max total size of one batch on phones
export const PC_MAX_BATCH_MB = 2000; // max total size of one batch on desktop

/** Total bytes allowed in one batch. Infinity on desktop. */
export function getMaxBatchBytes() {
  return isMobileDevice() ? MOBILE_MAX_BATCH_MB * MB : PC_MAX_BATCH_MB * MB;
}

let mobileCache = null;
let iosCache = null;

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

function detectIOS() {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports a Mac user agent but has a touch screen.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** iPhone / iPad. Safari decodes HEIC natively there, so HEIC is cheap. */
export function isIOSDevice() {
  if (typeof window === "undefined") return false;
  if (iosCache === null) iosCache = detectIOS();
  return iosCache;
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

/**
 * Warning level and batch limit for what is actually in play. Phones only: on desktop
 * this always answers "none" with no limit, so nothing changes there.
 *
 * Returns codes, not text, so the UI component owns all the wording:
 *   level:     "none" | "caution" | "strong"
 *   reason:    null | "android-heic" | "android-avif" | "ios-avif" | "android-heic-avif"
 *   fileLimit: the most files allowed in the queue (Infinity on desktop)
 *
 * @param {{ format: string, hasHeic: boolean }} input
 */
export function getMobileAdvice({ format, hasHeic }) {
  if (!isMobileDevice()) return { level: "none", reason: null, fileLimit: Infinity };

  const avif = format === "avif";
  const ios = isIOSDevice();

  // Both costs at once: memory-heavy HEIC decode (libheif) plus slow AVIF encode.
  if (avif && hasHeic && !ios) {
    return {
      level: "strong",
      reason: "android-heic-avif",
      fileLimit: MOBILE_FILE_LIMITS.heaviest,
    };
  }
  // AVIF is slow on every phone, whatever the source (including HEIC on iPhone).
  if (avif) {
    return {
      level: "caution",
      reason: ios ? "ios-avif" : "android-avif",
      fileLimit: MOBILE_FILE_LIMITS.heavy,
    };
  }
  // HEIC on Android goes through libheif, which is memory-heavy. iPhone decodes it natively.
  if (hasHeic && !ios) {
    return { level: "caution", reason: "android-heic", fileLimit: MOBILE_FILE_LIMITS.heavy };
  }
  return { level: "none", reason: null, fileLimit: MOBILE_FILE_LIMITS.standard };
}

/** Max AVIF Max Limit search passes. Read on the main thread and pass to the worker. */
export function getAvifMaxPasses() {
  return isMobileDevice() ? MOBILE_AVIF_MAX_PASSES : DESKTOP_AVIF_MAX_PASSES;
}

/** Largest AVIF output (in megapixels) allowed. Infinity on desktop. Pass to the worker. */
export function getAvifMaxMegapixels() {
  return isMobileDevice() ? MOBILE_AVIF_MAX_MEGAPIXELS : Infinity;
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
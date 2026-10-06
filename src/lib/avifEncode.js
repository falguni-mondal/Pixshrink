// Lazy AVIF encoder (WebAssembly via @jsquash/avif).
// The package is only downloaded the first time AVIF is actually requested.
// Works in a Web Worker or on the main thread, because it only needs ImageData.

let encoderPromise = null;

function loadEncoder() {
  if (!encoderPromise) {
    const promise = import("@jsquash/avif").then((m) => m.encode);
    encoderPromise = promise;
    // Allow a retry later if loading failed (but never clobber a newer promise).
    promise.catch(() => {
      if (encoderPromise === promise) encoderPromise = null;
    });
  }
  return encoderPromise;
}

/**
 * @param {ImageData} imageData raw RGBA pixels
 * @param {{ cqLevel?: number, speed?: number }} opts
 *   cqLevel: 0 (best quality) to 63 (smallest). speed: 0 (slowest, best) to 10 (fastest).
 * @returns {Promise<Blob>} an AVIF file
 */
export async function encodeAvif(imageData, { cqLevel = 33, speed = 6 } = {}) {
  const encode = await loadEncoder();
  const buffer = await encode(imageData, { cqLevel, speed });
  return new Blob([buffer], { type: "image/avif" });
}
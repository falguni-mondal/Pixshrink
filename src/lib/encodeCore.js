// Environment-agnostic image encoding. It runs inside a Web Worker (preferred, keeps the
// page smooth) or on the main thread as a fallback. It only touches the DOM in the
// fallback branch of makeCanvas().
//
// Correctness rules:
//  - The output format is never substituted. If the browser can't encode the requested
//    format, the file fails with a clear message.
//  - Every encoded file is verified (non-empty, correct container signature, expected
//    dimensions) before it is returned. A file that fails verification is an error.

import { isHeicFile } from "./fileTypes";
import { decodeHeicToBitmap } from "./heicDecode";
import { encodeAvif } from "./avifEncode";

export const MIME = {
  webp: "image/webp",
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
};

const MIN_MAX_KB = 10;
const MIN_QUALITY = 0.05;

// AVIF (WebAssembly encoder). cqLevel: 0 = best quality, 63 = smallest file.
const AVIF_SPEED = 6; // 0 = slowest/best ... 10 = fastest (T: tune after measuring)
const AVIF_BEST_CQ = 10; // cqLevel used at slider 100
const AVIF_MAX_CQ = 63; // cqLevel used at slider 1
const AVIF_MAX_PASSES = 6; // Max Limit search passes (T)

// Slider 100 -> cq 10, slider 1 -> cq 63, linear in between (T: tune against WebP sizes).
const avifCqFromSlider = (q100) =>
  Math.round(AVIF_MAX_CQ - ((q100 - 1) / 99) * (AVIF_MAX_CQ - AVIF_BEST_CQ));

export function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Canvas silently falls back to PNG when it can't encode a type,
// so we probe once per format and compare the returned blob type.
const supportCache = {};
export async function canEncode(format) {
  if (!(format in MIME)) return false;
  // Every browser can encode JPG and PNG, so never let the probe block them.
  if (format === "jpg" || format === "png") return true;
  // AVIF comes from our own WebAssembly encoder, not the canvas, so it only needs
  // WebAssembly. A failure to load the encoder surfaces as a clear per-file error.
  if (format === "avif") return typeof WebAssembly !== "undefined";
  if (format in supportCache) return supportCache[format];

  let ok = false;
  try {
    const canvas = makeCanvas(1, 1);
    // OffscreenCanvas.convertToBlob() rejects until a context exists, so create one first.
    canvas.getContext("2d");
    const blob = await canvasToBlob(canvas, MIME[format], 0.8);
    ok = !!blob && blob.type === MIME[format];
  } catch {
    ok = false;
  }
  supportCache[format] = ok;
  return ok;
}

/* ------------------------------------------------------------------ */
/* Cheap header parsing: used to decode big photos straight to a       */
/* smaller size, and to verify the size of what we encoded.            */
/* ------------------------------------------------------------------ */

const HEADER_BYTES = 512 * 1024; // JPEGs can carry large EXIF blocks before the size marker

/** @returns {Promise<{width:number,height:number}|null>} null if unknown */
async function getImageSize(file) {
  try {
    const b = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    if (b.length < 30) return null;

    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
      const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
      return w && h ? { width: w, height: h } : null;
    }

    // JPEG
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        // Markers without a length field
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const segLen = (b[i + 2] << 8) | b[i + 3];
        const isSOF =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
          const h = (b[i + 5] << 8) | b[i + 6];
          const w = (b[i + 7] << 8) | b[i + 8];
          return w && h ? { width: w, height: h } : null;
        }
        i += 2 + segLen;
      }
      return null;
    }

    // WebP
    const tag = String.fromCharCode(b[0], b[1], b[2], b[3], b[8], b[9], b[10], b[11]);
    if (tag === "RIFFWEBP") {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8 ") {
        return {
          width: ((b[26] | (b[27] << 8)) & 0x3fff),
          height: ((b[28] | (b[29] << 8)) & 0x3fff),
        };
      }
      if (chunk === "VP8L") {
        return {
          width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
          height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
        };
      }
      if (chunk === "VP8X") {
        return {
          width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
          height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Output verification                                                 */
/* ------------------------------------------------------------------ */

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

/**
 * Does this byte prefix look like the start of a file of `format`?
 * Needs at least 12 bytes (about 32 for AVIF to be sure).
 */
export function matchesFormatSignature(bytes, format) {
  if (!bytes || bytes.length < 12) return false;
  switch (format) {
    case "png":
      return bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG";
    case "jpg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    case "avif":
      return (
        ascii(bytes, 4, 8) === "ftyp" &&
        /avif|avis/.test(ascii(bytes, 8, Math.min(bytes.length, 32)))
      );
    default:
      return false;
  }
}

/** Throws if the encoded blob is not a sound file of the expected format and size. */
async function verifyOutput(blob, format, width, height) {
  if (!blob || blob.size === 0) {
    throw new Error("the encoder produced an empty file");
  }

  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (!matchesFormatSignature(head, format)) {
    throw new Error(`the result is not a valid ${format.toUpperCase()} file`);
  }

  // AVIF dimensions can't be read by our small header parser; PNG/JPEG/WebP can.
  if (format !== "avif") {
    const size = await getImageSize(blob);
    if (size && (size.width !== width || size.height !== height)) {
      throw new Error(
        `the result is ${size.width}x${size.height}px but ${width}x${height}px was expected`
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Compression                                                         */
/* ------------------------------------------------------------------ */

/**
 * Decodes the image, asking the browser to decode directly at the target width when that
 * is clearly a downscale. Falls back to a full decode whenever we aren't sure.
 *
 * We compare against min(width, height) because EXIF rotation can swap the two. If the
 * target is below the smaller side, the result is a downscale whichever way it's rotated.
 */
async function decodeForTarget(file, requestedWidth) {
  const target = Number(requestedWidth);
  if (target > 0 && !isHeicFile(file)) {
    const size = await getImageSize(file);
    if (size && target < Math.min(size.width, size.height)) {
      return decodeBitmap(file, { resizeWidth: Math.round(target), resizeQuality: "high" });
    }
  }
  return decodeBitmap(file);
}

/**
 * @param {File} file
 * @param {{ width: number|string, quality: number, format: string, maxKB?: number }} opts
 *   maxKB: size ceiling. The quality slider becomes the upper bound and we search downward
 *          for the highest quality that fits (ignored for PNG).
 * @returns {Promise<{ blob: Blob, format: string, width: number, height: number, missedTarget: boolean }>}
 *   `format` is always the requested format: it is never substituted. If the browser can't
 *   encode it, this throws. `missedTarget` is true when a maxKB limit was set but even the
 *   lowest quality didn't fit.
 */
export async function compressImage(file, { width, quality, format, maxKB = 0 }) {
  if (!(await canEncode(format))) {
    throw new Error(`${format.toUpperCase()} encoding isn't supported by this browser`);
  }
  const outFormat = format;
  const mime = MIME[outFormat];

  const bitmap = await decodeForTarget(file, width);
  let canvas = null;

  try {
    // Never upscale: a 500px image with a 1080px target stays 500px.
    const targetW = Math.min(Number(width) || bitmap.width, bitmap.width);
    const targetH = Math.max(1, Math.round(bitmap.height * (targetW / bitmap.width)));

    canvas = makeCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (outFormat === "jpg") {
      // JPG has no alpha channel; without this, transparent areas turn black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    // The pixels now live in the canvas, so free the decoded bitmap before encoding.
    bitmap.close?.();

    const q100 = Math.min(Math.max(Number(quality) || 80, 1), 100);
    const q = q100 / 100;
    const limitKB = Number(maxKB) > 0 ? Math.max(MIN_MAX_KB, Number(maxKB)) : 0;
    const limit = limitKB * 1024;

    let blob;
    let missedTarget = false;

    if (outFormat === "avif") {
      // The canvas can't encode AVIF, so hand the raw pixels to the WebAssembly encoder.
      const imageData = ctx.getImageData(0, 0, targetW, targetH);
      canvas.width = 0; // the pixels are in imageData now; free the canvas early
      canvas.height = 0;

      const encode = (cqLevel) => encodeAvif(imageData, { cqLevel, speed: AVIF_SPEED });

      const startCq = avifCqFromSlider(q100);
      blob = await encode(startCq);

      if (limit && blob.size > limit) {
        // Search for the lowest cqLevel (highest quality) at or above the slider's level
        // that fits the limit. Capped at AVIF_MAX_PASSES encodes, because AVIF is slow.
        let lo = startCq + 1;
        let hi = AVIF_MAX_CQ;
        let best = null;
        let lastTooBig = null;
        let triedMax = startCq >= AVIF_MAX_CQ;

        for (let pass = 0; pass < AVIF_MAX_PASSES && lo <= hi; pass++) {
          const mid = (lo + hi) >> 1;
          const candidate = await encode(mid);
          if (mid === AVIF_MAX_CQ) triedMax = true;
          if (candidate.size <= limit) {
            best = candidate;
            hi = mid - 1;
          } else {
            lastTooBig = candidate;
            lo = mid + 1;
          }
        }

        if (best) blob = best;
        else if (triedMax) blob = lastTooBig ?? blob;
        else blob = await encode(AVIF_MAX_CQ); // nothing fit: take the smallest possible
      }
      missedTarget = Boolean(limit) && blob.size > limit;
    } else {
      blob = await canvasToBlob(canvas, mime, q);
      if (!blob) throw new Error("Browser failed to encode the image");

      if (limit && outFormat !== "png" && blob.size > limit) {
        // Binary search for the highest quality (<= slider value) that fits the limit.
        let lo = MIN_QUALITY;
        let hi = q;
        let best = null;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          const candidate = await canvasToBlob(canvas, mime, mid);
          if (candidate && candidate.size <= limit) {
            best = candidate;
            lo = mid;
          } else {
            hi = mid;
          }
        }
        // If even the lowest quality is too big, keep that best-effort result and flag it.
        blob = best ?? (await canvasToBlob(canvas, mime, MIN_QUALITY));
        if (!blob) throw new Error("Browser failed to encode the image");
        missedTarget = blob.size > limit;
      }
    }

    await verifyOutput(blob, outFormat, targetW, targetH);
    return { blob, format: outFormat, width: targetW, height: targetH, missedTarget };
  } catch (error) {
    // Name the file so a failure in the results panel is identifiable.
    if (error?.message && !error.message.includes(file.name)) {
      error.message = `"${file.name}": ${error.message}`;
    }
    throw error;
  } finally {
    bitmap.close?.();
    // Force Safari/Chrome to drop the uncompressed pixel array right away
    // rather than waiting for the lazy garbage collector.
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/**
 * Decodes any supported image into an ImageBitmap.
 * 1) The browser's own decoder (fast; Safari/iOS handle HEIC natively here).
 * 2) The same file re-read from memory (works around handles the decoder can't use).
 * 3) For HEIC files the browser can't read (Chrome, Edge, Firefox), the libheif WASM decoder.
 * The final error keeps the browser's real reason, so failures can be diagnosed.
 */
export async function decodeBitmap(file, options) {
  let lastError;

  // 1) Direct decode, with the resize options first, then without them.
  const attempts = options ? [options, undefined] : [undefined];
  for (const opts of attempts) {
    try {
      return opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
    } catch (e) {
      lastError = e;
    }
  }

  // 2) Re-read the bytes and decode from memory.
  try {
    const buffer = await file.arrayBuffer();
    return await createImageBitmap(new Blob([buffer], { type: file.type }));
  } catch (e) {
    lastError = e;
  }

  // 3) HEIC fallback through libheif.
  if (isHeicFile(file)) {
    try {
      return await decodeHeicToBitmap(file);
    } catch (heicError) {
      throw new Error(`Couldn't decode "${file.name}" (${heicError.message})`);
    }
  }

  const reason = lastError ? `${lastError.name || "Error"}: ${lastError.message || "unknown"}` : "unknown";
  throw new Error(`This browser can't read "${file.name}" (${file.type || "unknown type"}) - ${reason}`);
}

/** Small center-cropped square preview as a JPEG blob. */
export async function renderThumbnail(file, size = 160) {
  const bitmap = await decodeBitmap(file, { resizeWidth: size * 3, resizeQuality: "medium" });
  let canvas = null;
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    canvas = makeCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    // JPEG has no alpha, so paint a white background for transparent PNG/WebP.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);

    // JPEG is encodable everywhere. WebP would silently turn into PNG on some browsers.
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.75);
    if (!blob) throw new Error("Could not create thumbnail");
    return blob;
  } finally {
    bitmap.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
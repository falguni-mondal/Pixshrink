// Environment-agnostic image encoding. It runs inside a Web Worker (preferred, keeps the
// page smooth) or on the main thread as a fallback. It only touches the DOM in the
// fallback branch of makeCanvas().

import { isHeicFile } from "./fileTypes";
import { decodeHeicToBitmap } from "./heicDecode";

export const MIME = {
  webp: "image/webp",
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
};

const MIN_MAX_KB = 10;
const MIN_QUALITY = 0.05;

export function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
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

/**
 * Returns `format` if this browser can encode it, otherwise the best supported
 * alternative (webp, then jpg). JPG is always supported, so this never returns null.
 */
export async function pickSupportedFormat(format) {
  for (const f of [format, "webp", "jpg"]) {
    if (await canEncode(f)) return f;
  }
  return "jpg";
}

/* ------------------------------------------------------------------ */
/* Cheap header parsing: lets us decode big photos straight to a       */
/* smaller size instead of decoding every pixel first.                 */
/* ------------------------------------------------------------------ */

const HEADER_BYTES = 512 * 1024; // JPEGs can carry large EXIF blocks before the size marker

/** @returns {Promise<{width:number,height:number}|null>} null if unknown (caller decodes fully) */
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
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        if (marker === 0xff) {
          i++;
          continue;
        }
        // Markers without a length field
        if (
          marker === 0xd8 ||
          marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7)
        ) {
          i += 2;
          continue;
        }
        const segLen = (b[i + 2] << 8) | b[i + 3];
        const isSOF =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
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
    const tag = String.fromCharCode(
      b[0],
      b[1],
      b[2],
      b[3],
      b[8],
      b[9],
      b[10],
      b[11],
    );
    if (tag === "RIFFWEBP") {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8 ") {
        return {
          width: (b[26] | (b[27] << 8)) & 0x3fff,
          height: (b[28] | (b[29] << 8)) & 0x3fff,
        };
      }
      if (chunk === "VP8L") {
        return {
          width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
          height:
            1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
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
      return decodeBitmap(file, {
        resizeWidth: Math.round(target),
        resizeQuality: "high",
      });
    }
  }
  return decodeBitmap(file);
}

/**
 * @param {File} file
 * @param {{ width: number|string, quality: number, format: string, maxKB?: number, allowFallback?: boolean }} opts
 *   maxKB: size ceiling. The quality slider becomes the upper bound and we search downward
 *          for the highest quality that fits (ignored for PNG).
 *   allowFallback: if the browser can't encode `format`, use WebP (then JPG) instead of failing.
 * @returns {Promise<{ blob: Blob, format: string }>} the blob plus the format actually used
 */
export async function compressImage(
  file,
  { width, quality, format, maxKB = 0, allowFallback = false },
) {
  let outFormat = format;
  if (!(await canEncode(outFormat))) {
    if (!allowFallback) {
      throw new Error(
        `${outFormat.toUpperCase()} encoding isn't supported by this browser`,
      );
    }
    outFormat = await pickSupportedFormat(outFormat);
  }
  const mime = MIME[outFormat];

  const bitmap = await decodeForTarget(file, width);
  let canvas = null;

  try {
    // Never upscale: a 500px image with a 1080px target stays 500px.
    const targetW = Math.min(Number(width) || bitmap.width, bitmap.width);
    const targetH = Math.max(
      1,
      Math.round(bitmap.height * (targetW / bitmap.width)),
    );

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

    const q = Math.min(Math.max(Number(quality) || 80, 1), 100) / 100;
    let blob = await canvasToBlob(canvas, mime, q);
    if (!blob) throw new Error("Browser failed to encode the image");

    const limitKB = Number(maxKB) > 0 ? Math.max(MIN_MAX_KB, Number(maxKB)) : 0;
    const limit = limitKB * 1024;
    if (!limit || outFormat === "png" || blob.size <= limit) {
      return { blob, format: outFormat };
    }

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
    // If even the lowest quality is too big, return that best-effort result.
    blob = best ?? (await canvasToBlob(canvas, mime, MIN_QUALITY));
    return { blob, format: outFormat };
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
 * 2) For HEIC files the browser can't read (Chrome, Edge, Firefox), the libheif WASM decoder.
 */
export async function decodeBitmap(file, options) {
  let lastError;

  // 1) Direct decode, with the resize options first, then without them.
  const attempts = options ? [options, undefined] : [undefined];
  for (const opts of attempts) {
    try {
      return opts
        ? await createImageBitmap(file, opts)
        : await createImageBitmap(file);
    } catch (e) {
      lastError = e;
    }
  }

  // 2) Re-read the bytes and decode from memory. This works around handles that the
  //    decoder can't use directly, and gives a clear error if the file is truly unreadable.
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

  const reason = lastError
    ? `${lastError.name || "Error"}: ${lastError.message || "unknown"}`
    : "unknown";
  throw new Error(
    `This browser can't read "${file.name}" (${file.type || "unknown type"}) - ${reason}`,
  );
}

/** Small center-cropped square preview as a JPEG blob. */
export async function renderThumbnail(file, size = 160) {
  const bitmap = await decodeBitmap(file, {
    resizeWidth: size * 3,
    resizeQuality: "medium",
  });
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

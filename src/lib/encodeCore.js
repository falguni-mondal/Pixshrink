// Environment-agnostic image encoding. It runs inside a Web Worker (preferred, keeps the
// page smooth) or on the main thread as a fallback. It only touches the DOM in the
// fallback branch of makeCanvas().

export const MIME = {
  webp: "image/webp",
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
};

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
 * @param {File} file
 * @param {{ width: number|string, quality: number, format: string, maxKB?: number, allowFallback?: boolean }} opts
 *   maxKB: size ceiling. The quality slider becomes the upper bound and we search downward
 *          for the highest quality that fits (ignored for PNG).
 *   allowFallback: if the browser can't encode `format`, use WebP instead of failing.
 * @returns {Promise<{ blob: Blob, format: string }>} the blob plus the format actually used
 */
export async function compressImage(
  file,
  { width, quality, format, maxKB = 0, allowFallback = false }
) {
  let outFormat = format;
  if (!(await canEncode(outFormat))) {
    if (allowFallback && (await canEncode("webp"))) outFormat = "webp";
    else throw new Error(`${outFormat.toUpperCase()} encoding isn't supported by this browser`);
  }
  const mime = MIME[outFormat];

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`This browser can't read "${file.name}" (${file.type || "unknown type"})`);
  }

  try {
    // Never upscale: a 500px image with a 1080px target stays 500px.
    const targetW = Math.min(Number(width) || bitmap.width, bitmap.width);
    const targetH = Math.max(1, Math.round(bitmap.height * (targetW / bitmap.width)));

    const canvas = makeCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (outFormat === "jpg") {
      // JPG has no alpha channel; without this, transparent areas turn black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const q = Math.min(Math.max(Number(quality) || 80, 1), 100) / 100;
    let blob = await canvasToBlob(canvas, mime, q);
    if (!blob) throw new Error("Browser failed to encode the image");

    const limit = maxKB * 1024;
    if (!limit || outFormat === "png" || blob.size <= limit) {
      return { blob, format: outFormat };
    }

    // Binary search for the highest quality (<= slider value) that fits the limit.
    let lo = 0.05;
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
    blob = best ?? (await canvasToBlob(canvas, mime, 0.05));
    return { blob, format: outFormat };
  } finally {
    bitmap.close?.();
  }
}
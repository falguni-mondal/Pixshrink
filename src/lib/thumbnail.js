// Generates small square preview thumbnails so the queue never keeps full-size photos
// decoded in memory. A 10 MB photo becomes a ~5 KB preview.
import { makeCanvas, canvasToBlob } from "./encodeCore";

const THUMB = 160; // px, enough for crisp previews on 2x screens
const MAX_CONCURRENT = 2; // decode at most 2 full images at once

let active = 0;
const queue = [];

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

async function render(file) {
  // Ask the browser to decode at reduced size where supported (much less memory),
  // and fall back to a normal decode where the options are ignored or unsupported.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: THUMB * 3, resizeQuality: "medium" });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  try {
    // Center-crop to a square, matching how the grid displays it (object-cover).
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = makeCanvas(THUMB, THUMB);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, THUMB, THUMB);

    const blob = await canvasToBlob(canvas, "image/webp", 0.7);
    if (!blob) throw new Error("Could not create thumbnail");
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {File} file
 * @param {{ signal?: AbortSignal }} [options] aborting skips the work if it hasn't started
 * @returns {Promise<string>} an object URL; the caller must revoke it
 */
export function makeThumbnail(file, { signal } = {}) {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      try {
        resolve(await render(file));
      } catch (error) {
        reject(error);
      }
    });
    pump();
  });
}
// Generates small square preview thumbnails so the queue never keeps full-size photos
// decoded in memory. A 10 MB photo becomes a ~5 KB preview. The decoding itself
// (including HEIC) happens in the Web Worker; this file only paces the requests.
import { thumbnailLocally } from "./localCompress";

const THUMB = 160; // px, enough for crisp previews on 2x screens
const MAX_CONCURRENT = 2; // at most 2 thumbnails in flight at once

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
  const blob = await thumbnailLocally(file, THUMB);
  return URL.createObjectURL(blob);
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
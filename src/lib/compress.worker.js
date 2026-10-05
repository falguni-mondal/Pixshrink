// Runs decoding, compression and thumbnails off the main thread, so the page and the loading
// animation never freeze (HEIC decoding in particular is CPU heavy).
import { compressImage, renderThumbnail } from "./encodeCore";

self.onmessage = async (event) => {
  const { id, type, file, opts, size } = event.data;
  try {
    const result =
      type === "thumb" ? await renderThumbnail(file, size) : await compressImage(file, opts);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
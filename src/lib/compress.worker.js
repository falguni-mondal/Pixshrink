// Runs compression off the main thread so the page (and the loading animation) never freezes.
import { compressImage } from "./encodeCore";

self.onmessage = async (event) => {
  const { id, file, opts } = event.data;
  try {
    const { blob, format } = await compressImage(file, opts);
    self.postMessage({ id, ok: true, blob, format });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
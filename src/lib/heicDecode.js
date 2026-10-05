// Decodes HEIC/HEIF with libheif (WebAssembly) for browsers that can't do it natively
// (Chrome, Edge, Firefox). Safari and iOS decode HEIC themselves and never reach this file.
//
// The decoder (~1.5 MB+) is NOT part of the app bundle. It is self-hosted at
// /libheif/libheif-bundle.js (copied from node_modules by scripts/copy-libheif.mjs) and is
// only downloaded the first time someone adds a HEIC file. Loading it as a plain script
// keeps it independent of webpack/Turbopack quirks.

const DECODER_URL = "/libheif/libheif-bundle.js";

let libheifPromise = null;

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("could not load the HEIC decoder script"));
    document.head.appendChild(el);
  });
}

function loadLibheif() {
  if (!libheifPromise) {
    libheifPromise = (async () => {
      if (typeof self.importScripts === "function") self.importScripts(DECODER_URL); // inside the worker
      else await injectScript(DECODER_URL); // main-thread fallback

      let lib = globalThis.libheif;
      if (typeof lib === "function") lib = await lib(); // in case the build exposes a factory
      if (!lib?.HeifDecoder) {
        throw new Error('HEIC decoder not found. Run "node scripts/copy-libheif.mjs" and restart.');
      }
      return lib;
    })();
    // Allow a retry later if loading failed
    libheifPromise.catch(() => {
      libheifPromise = null;
    });
  }
  return libheifPromise;
}

// HEIC decoding is CPU- and memory-heavy (a 12 MP photo needs ~48 MB of raw pixels),
// so decode one file at a time.
let decodeQueue = Promise.resolve();

export function decodeHeicToBitmap(file) {
  const job = decodeQueue.then(() => decodeNow(file));
  decodeQueue = job.catch(() => {});
  return job;
}

async function decodeNow(file) {
  const libheif = await loadLibheif();
  let images = [];
  try {
    const decoder = new libheif.HeifDecoder();
    images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
    if (!images?.length) throw new Error("no image found in the file");

    // Burst photos and Live Photos contain several images; use the primary one.
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();

    const pixels = await new Promise((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) => {
        if (out) resolve(out.data);
        else reject(new Error("libheif could not render the image"));
      });
    });

    return await createImageBitmap(new ImageData(pixels, width, height));
  } catch (error) {
    // A WASM instance that ran out of memory or aborted can't be trusted; reload it next time.
    libheifPromise = null;
    throw error;
  } finally {
    for (const image of images) image.free?.();
  }
}
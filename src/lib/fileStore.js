// Disk-backed stash for picked files (phones only). The picker's File is only a lazy
// handle that can expire; one read right after the pick moves the bytes into IndexedDB
// (stored on disk, not in the JS heap) and we keep a File backed by that copy.
import { isMobileDevice } from "./device";

const DB = "pixshrink-stash";
const STORE = "files";
const RAM_FILE_MAX = 8 * 1024 * 1024; // fallback only: small files
const RAM_TOTAL_MAX = 96 * 1024 * 1024; // fallback only: total cap
const SOURCE_ERRORS = new Set(["NotFoundError", "NotReadableError", "SecurityError"]);

const ram = new Map(); // id -> bytes held by the fallback
let ramBytes = 0;
let dbp;

const db = () =>
  (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }).catch((e) => {
    dbp = undefined;
    throw e;
  }));

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error || req?.error);
  });
}

const rewrap = (blob, file) =>
  new File([blob], file.name, { type: file.type, lastModified: file.lastModified });

/** Reads `file` once and returns a File that can no longer expire. Throws if the source is unreadable. */
export async function stash(id, file) {
  try {
    await tx("readwrite", (s) => s.put(file, id));
    const blob = await tx("readonly", (s) => s.get(id));
    if (!blob) throw new Error("stash returned nothing");
    return rewrap(blob, file);
  } catch (e) {
    if (SOURCE_ERRORS.has(e?.name)) throw e; // the file itself is gone
    // Storage unavailable or full: small files get an in-memory copy, big ones stay as-is.
    if (file.size <= RAM_FILE_MAX && ramBytes + file.size <= RAM_TOTAL_MAX) {
      const copy = rewrap(await file.arrayBuffer(), file); // throws if the source is gone
      ram.set(id, copy.size);
      ramBytes += copy.size;
      return copy;
    }
    // Big file, nowhere to copy it. Read one byte so a lapsed handle still gets flagged
    // as broken now (it throws), instead of failing later at compress time. No RAM cost.
    await file.slice(0, 1).arrayBuffer();
    return file;
  }
}

// Desktop never stashes anything, so these must not even open IndexedDB there.
export function unstash(id) {
  if (!isMobileDevice()) return Promise.resolve();
  if (ram.has(id)) {
    ramBytes -= ram.get(id);
    ram.delete(id);
  }
  return tx("readwrite", (s) => s.delete(id)).catch(() => {});
}

export function clearStash() {
  if (!isMobileDevice()) return Promise.resolve();
  ram.clear();
  ramBytes = 0;
  return tx("readwrite", (s) => s.clear()).catch(() => {});
}
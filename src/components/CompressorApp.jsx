"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import CompressionControls from "@/components/CompressionControls";
import DonateCard from "@/components/DonateCard";
import ImageDropzone from "@/components/ImageDropzone";
import WelcomeModal from "@/components/WelcomeModal";
import FormatWarning, {
  ConfirmCompressDialog,
  estimateText,
} from "@/components/FormatWarning";
import { LoadingOverlay, PixelStyles } from "@/components/PixelLoader";
import { getLenis } from "@/components/SmoothScroll";
import { compressLocally } from "@/lib/localCompress";
import { matchesFormatSignature } from "@/lib/encodeCore";
import { isHeicFile } from "@/lib/fileTypes";
import {
  getAvifMaxMegapixels,
  getAvifMaxPasses,
  getConcurrency,
  getMobileAdvice,
  getPartLimit,
  isMobileDevice,
  prefersReducedMotion,
} from "@/lib/device";

const NOTICE_MS = 6000;
const MAX_KB_FLOOR = 10; // same floor as encodeCore.js

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const stripExt = (name) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

const base64Size = (b64) =>
  Math.floor((b64.length * 3) / 4) -
  (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

// Checks that data returned by ImageKit really is a file of the format we asked for.
// Only the first 64 base64 characters (48 bytes) are decoded, which is enough for the signature.
function verifyCloudOutput(b64, format) {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("ImageKit returned no image data");
  }
  let bytes;
  try {
    const bin = atob(b64.slice(0, 64));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    throw new Error("ImageKit returned data that could not be read");
  }
  if (!matchesFormatSignature(bytes, format)) {
    throw new Error(
      `ImageKit returned a file that is not a valid ${format.toUpperCase()}`,
    );
  }
}

const makeNameRegistry = () => {
  const used = new Set();
  return (name) => {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    let n = 1;
    while (used.has(candidate.toLowerCase()))
      candidate = `${base} (${n++})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROBE_TIMEOUT_MS = 4000;

// Reads a single byte to check the browser still has access to the file. On phones the file
// picker hands out temporary references that can lapse (gallery app backgrounded, screen
// locked...). Costs no memory: nothing is kept. A slow read is NOT treated as a failure,
// so a sluggish storage never gets a good file removed by mistake.
async function isReadable(file) {
  let timer;
  try {
    await Promise.race([
      file.slice(0, 1).arrayBuffer(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// "about 6 min left", from the rolling average of recent files.
const formatEta = (ms) =>
  ms < 45_000
    ? "less than a minute left"
    : `about ${Math.max(1, Math.round(ms / 60_000))} min left`;

// Short names for the batch-limit message (reason codes come from getMobileAdvice).
const LIMIT_LABEL = {
  "android-heic-avif": "HEIC to AVIF",
  "android-avif": "AVIF",
  "ios-avif": "AVIF",
  "android-heic": "HEIC photos",
};

const unreadableMessage = (names) => {
  const many = names.length !== 1;
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `${names.length} image${many ? "s" : ""} could not be read because the browser lost access to ${many ? "them" : "it"}: ${shown}${more}. ${many ? "They were" : "It was"} removed from the queue. Add ${many ? "them" : "it"} again.`;
};

// Same name + size + modified time means the same file picked twice.
const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;

let idCounter = 0;
const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const EMPTY_RUN = {
  ok: 0,
  imagekit: 0,
  local: 0,
  kept: 0,
  failed: [],
  unreadable: [], // names of files the browser lost access to (removed before the run)
  stopped: 0,
  cancelled: false,
  missed: [], // [{ name, size }] still above the Max Limit
  limitKB: 0,
  formats: {}, // { webp: 12 } output formats actually produced
};

const PAGE_CSS = `
.ps-reveal,.ps-word{opacity:0;animation:ps-failsafe 0s linear 3.5s forwards}
.ps-word{display:inline-block;will-change:transform}
.ps-mask{display:inline-block;overflow:hidden;vertical-align:top;padding:.1em 0 .16em;margin:-.1em 0 -.16em}
@keyframes ps-failsafe{to{opacity:1}}
.ps-blink{animation:ps-blink 1.4s steps(1,end) infinite}
@keyframes ps-blink{0%,55%{opacity:1}56%,100%{opacity:.2}}
@media (prefers-reduced-motion:reduce){
  .ps-reveal,.ps-word{opacity:1;animation:none}
  .ps-blink{animation:none}
}
`;

function Words({ text }) {
  const words = text.split(" ");
  return words.map((word, i) => (
    <span key={i}>
      <span className="ps-mask">
        <span className="ps-word">{word}</span>
      </span>
      {i < words.length - 1 ? " " : null}
    </span>
  ));
}

function StepLabel({ n, children }) {
  return (
    <div className="relative mb-6 flex items-center pt-4 sm:mb-8 sm:pt-6">
      <span
        aria-hidden="true"
        className="absolute -left-2 -top-1 z-0 select-none font-[family-name:var(--font-pixel)] text-[5rem] leading-none text-neutral-900/5 sm:-left-4 sm:-top-2 sm:text-[7rem]"
      >
        {n}
      </span>
      <h2 className="relative z-10 text-xl font-black uppercase tracking-tight text-neutral-900 sm:text-2xl">
        {children}
      </h2>
    </div>
  );
}

export default function CompressorApp({ imagekitAvailable = false }) {
  const [files, setFiles] = useState([]);
  const [width, setWidth] = useState(1080);
  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState("webp");

  const [engine, setEngine] = useState("local");
  const activeEngine = imagekitAvailable ? engine : "local";
  const [maxKB, setMaxKB] = useState("");
  const [keepIfLarger, setKeepIfLarger] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState("compress");
  const [progress, setProgress] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [etaMs, setEtaMs] = useState(0); // estimated time left, 0 until the first file is done
  const [stopping, setStopping] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const [runInfo, setRunInfo] = useState(EMPTY_RUN);
  const [markActive, setMarkActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false); // strong-warning confirm dialog (phones)

  const [adding, setAdding] = useState(null); // { done, total } while HEIC copies run (phones)
  const addTotalRef = useRef(0);
  const addDoneRef = useRef(0);

  const cancelRef = useRef(false);
  const startingRef = useRef(false); // true only during the quick pre-run readability check
  // The add-time limit depends on the chosen format, but handleFilesAdded must stay stable.
  const formatRef = useRef(format);
  formatRef.current = format;
  const urlsRef = useRef([]);
  // Always holds the latest queue, so async code never works from a stale list.
  const filesRef = useRef([]);
  const noticeTimerRef = useRef(null);

  const pageRef = useRef(null);
  const buttonWrapRef = useRef(null);
  const buttonRef = useRef(null);
  const resultsRef = useRef(null);
  const errorRef = useRef(null);
  const newSizeRef = useRef(null);
  const savedRef = useRef(null);
  const barRef = useRef(null);

  // Can this device share files (the "Save to Files" sheet on phones)?
  const canShareZip = useMemo(() => {
    try {
      return (
        isMobileDevice() &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({
          files: [new File([""], "pixshrink.zip", { type: "application/zip" })],
        })
      );
    } catch {
      return false;
    }
  }, []);

  const commitFiles = useCallback((updater) => {
    const next = updater(filesRef.current);
    filesRef.current = next;
    setFiles(next);
  }, []);

  const showNotice = useCallback((message) => {
    clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(""), NOTICE_MS);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  const handleFilesAdded = useCallback(
    async (incoming) => {
      const mobile = isMobileDevice();
      const stats = { dupes: 0, overCap: 0, capLimit: Infinity, capReason: null };

      // Phase 1 (instant): validate and show every tile right away. No bytes are read yet,
      // and there is no await, so the cap/duplicate checks can't race with another add.
      const current = filesRef.current;
      const seen = new Set(current.map((f) => f.key));
      // Phones: the limit depends on what the queue would contain (HEIC on Android, AVIF
      // output...), so each file is checked against the limit it would bring with it.
      // A heavy file is refused when it would push the queue over that limit; light files
      // can still fill the queue up to the normal cap.
      let count = current.length;
      let heicInQueue = current.some((f) => isHeicFile(f.file));
      const accepted = [];
      for (const file of incoming) {
        const key = fileKey(file);
        if (seen.has(key)) {
          stats.dupes++;
          continue;
        }
        if (mobile) {
          const heic = isHeicFile(file);
          const advice = getMobileAdvice({
            format: formatRef.current,
            hasHeic: heicInQueue || heic,
          });
          if (count >= advice.fileLimit) {
            stats.overCap++;
            if (advice.fileLimit < stats.capLimit) {
              stats.capLimit = advice.fileLimit;
              stats.capReason = advice.reason;
            }
            continue;
          }
          if (heic) heicInQueue = true;
        }
        seen.add(key);
        count++;
        accepted.push({ id: makeId(), key, file });
      }
      if (accepted.length) commitFiles((prev) => [...prev, ...accepted]);
      setShowResults(false);

      const parts = [];
      if (stats.overCap) {
        const what = LIMIT_LABEL[stats.capReason];
        parts.push(
          what
            ? `${stats.overCap} not added: with ${what}, this phone handles up to ${stats.capLimit} images per batch`
            : `${stats.overCap} not added: mobile batches are capped at ${stats.capLimit} images`,
        );
      }
      if (stats.dupes) {
        parts.push(
          `${stats.dupes} duplicate${stats.dupes === 1 ? "" : "s"} skipped`,
        );
      }
      if (parts.length) showNotice(`${parts.join(". ")}.`);

      // Phase 2 (background, phones only): copy each HEIC into RAM so it stays readable.
      // The tile's `file` is swapped when its copy is ready.
      const heics = mobile ? accepted.filter((a) => isHeicFile(a.file)) : [];
      if (!heics.length) return;

      addTotalRef.current += heics.length;
      setAdding({ done: addDoneRef.current, total: addTotalRef.current });

      for (const item of heics) {
        try {
          const buffer = await item.file.arrayBuffer();
          const safe = new File([buffer], item.file.name, {
            type: item.file.type || "image/heic",
            lastModified: item.file.lastModified,
          });
          commitFiles((prev) =>
            prev.map((f) => (f.id === item.id ? { ...f, file: safe } : f)),
          );
        } catch (err) {
          console.warn(`Could not eager-load ${item.file.name} into RAM:`, err);
        }

        addDoneRef.current++;
        if (addDoneRef.current >= addTotalRef.current) {
          addDoneRef.current = 0;
          addTotalRef.current = 0;
          setAdding(null);
        } else {
          setAdding({ done: addDoneRef.current, total: addTotalRef.current });
        }
        await sleep(10);
      }
    },
    [commitFiles, showNotice],
  );

  const handleRemoveFile = useCallback(
    (idToRemove) =>
      commitFiles((prev) => prev.filter((f) => f.id !== idToRemove)),
    [commitFiles],
  );

  const handleClearAll = useCallback(
    () => commitFiles(() => []),
    [commitFiles],
  );

  useEffect(() => {
    if (!isProcessing) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isProcessing]);

  // Keep the screen awake while processing. A sleeping phone suspends the tab and the batch dies.
  // The browser drops the lock when the tab is hidden, so ask again when it comes back.
  useEffect(() => {
    if (
      !isProcessing ||
      typeof navigator === "undefined" ||
      !("wakeLock" in navigator)
    )
      return;
    let lock = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      } catch {
        // Denied (e.g. low battery mode). Processing still works, the screen may just sleep.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released))
        acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [isProcessing]);

  useEffect(() => {
    return () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const processImages = async () => {
    if (files.length === 0 || startingRef.current) return;

    // Pre-check: drop files the browser can no longer read, so they can't fail deep into
    // the batch. Everything else carries on, and the app is never blocked.
    startingRef.current = true;
    const readable = [];
    const dead = [];
    try {
      for (const item of files) {
        (await isReadable(item.file) ? readable : dead).push(item);
      }
    } finally {
      startingRef.current = false;
    }

    const unreadable = dead.map((d) => d.file.name);
    if (dead.length) {
      const deadIds = new Set(dead.map((d) => d.id));
      commitFiles((prev) => prev.filter((f) => !deadIds.has(f.id)));
    }
    if (readable.length === 0) {
      setRunInfo({
        ...EMPTY_RUN,
        failed: [{ name: "Unreadable files", reason: unreadableMessage(unreadable) }],
      });
      setShowResults(true);
      return;
    }
    const queue = readable;

    cancelRef.current = false;
    setStopping(false);
    setStage("compress");
    setDoneCount(0);
    setEtaMs(0);
    setTotalCount(queue.length);
    setProgress(0);
    setShowResults(false);
    setIsProcessing(true);

    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
    setDownloads([]);

    try {
      const { default: JSZip } = await import("jszip");

      const uniqueName = makeNameRegistry();
      const targetKB =
        Number(maxKB) > 0 && format !== "png"
          ? Math.max(MAX_KB_FLOOR, Number(maxKB))
          : 0;
      const limitBytes = targetKB * 1024;

      const stats = { imagekit: 0, local: 0, kept: 0 };
      const formatCounts = {};
      const missed = [];
      const succeeded = new Set();
      const failed = [];
      let completedCount = 0;
      const stamps = [Date.now()]; // run start, then one entry per finished file (for the ETA)
      let okOriginalBytes = 0;
      let totalCompressedBytes = 0;

      let current = { zip: new JSZip(), bytes: 0 };
      const partJobs = [];
      const generate = (zip) =>
        zip.generateAsync({ type: "blob", compression: "STORE" });
      const addToZip = (name, content, options, size) => {
        current.zip.file(uniqueName(name), content, options);
        current.bytes += size;
        if (current.bytes >= getPartLimit()) {
          const full = current;
          current = { zip: new JSZip(), bytes: 0 };
          partJobs.push(generate(full.zip));
        }
      };

      const viaImageKit = async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("width", width.toString());
        formData.append("quality", quality.toString());
        formData.append("format", format);

        const res = await fetch("/api/compress", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Unknown error");

        // Never trust the cloud blindly: it must be the format we asked for.
        verifyCloudOutput(data.data, format);

        return {
          name: data.fileName,
          content: data.data,
          options: { base64: true },
          size: base64Size(data.data),
          format,
        };
      };

      const viaLocal = async (file) => {
        // The requested format is never substituted. If this browser can't encode it,
        // compressLocally throws and the file stays in the queue.
        const { blob, format: usedFormat } = await compressLocally(file, {
          width,
          quality,
          format,
          maxKB: targetKB,
          // The worker can't detect the device, so the limits are read here and passed in.
          avifMaxPasses: getAvifMaxPasses(),
          avifMaxMegapixels: getAvifMaxMegapixels(),
        });
        return {
          name: `${stripExt(file.name)}_compressed.${usedFormat}`,
          content: blob,
          options: {},
          size: blob.size,
          format: usedFormat,
        };
      };

      const handleOne = async (obj) => {
        try {
          let out;
          let used;

          if (activeEngine === "local" || targetKB) {
            out = await viaLocal(obj.file);
            used = "local";
          } else if (activeEngine === "auto") {
            try {
              out = await viaImageKit(obj.file);
              used = "imagekit";
            } catch (err) {
              console.warn(
                `ImageKit failed for ${obj.file.name}, using local engine:`,
                err.message,
              );
              out = await viaLocal(obj.file);
              used = "local";
            }
          } else {
            out = await viaImageKit(obj.file);
            used = "imagekit";
          }

          let finalSize;
          if (keepIfLarger && out.size >= obj.file.size) {
            addToZip(obj.file.name, obj.file, {}, obj.file.size);
            finalSize = obj.file.size;
            stats.kept++;
          } else {
            addToZip(out.name, out.content, out.options, out.size);
            finalSize = out.size;
            stats[used]++;
            formatCounts[out.format] = (formatCounts[out.format] || 0) + 1;
          }
          totalCompressedBytes += finalSize;
          okOriginalBytes += obj.file.size;
          succeeded.add(obj.id);

          // Report honestly when a Max Limit was set but the file ended up above it.
          if (limitBytes && finalSize > limitBytes) {
            missed.push({ name: obj.file.name, size: finalSize });
          }
        } catch (error) {
          console.error(`Error processing ${obj.file.name}:`, error.message);
          failed.push({ name: obj.file.name, reason: error.message });
        } finally {
          completedCount++;
          setDoneCount(completedCount);
          setProgress((completedCount / queue.length) * 100);

          // Rolling average over the last few files, so one slow file (or the first one,
          // which also loads the decoder/encoder) doesn't skew the estimate for long.
          stamps.push(Date.now());
          const recent = stamps.slice(-6);
          const avgMs = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
          setEtaMs(avgMs * (queue.length - completedCount));

          // Short yield so the UI stays responsive. Memory is handled in encodeCore
          // (decode-time downscale + canvas release), not by waiting.
          await sleep(isMobileDevice() ? 50 : 10);
        }
      };

      let cursor = 0;
      const runner = async () => {
        while (!cancelRef.current && cursor < queue.length) {
          const obj = queue[cursor++];
          await handleOne(obj);
        }
      };
      // With a Max Limit every file goes to the local engine, so use the worker pool size.
      const cloudOnly = activeEngine === "imagekit" && !targetKB;
      await Promise.all(
        Array.from(
          { length: getConcurrency(cloudOnly ? "imagekit" : "local") },
          runner,
        ),
      );

      const wasCancelled = cancelRef.current;
      const okCount = succeeded.size;
      const notAttempted = wasCancelled
        ? queue.length - succeeded.size - failed.length
        : 0;

      setOriginalSize(okOriginalBytes);
      setCompressedSize(totalCompressedBytes);
      setRunInfo({
        ok: okCount,
        ...stats,
        failed,
        unreadable,
        stopped: notAttempted,
        cancelled: wasCancelled,
        missed,
        limitKB: targetKB,
        formats: formatCounts,
      });

      if (okCount > 0) {
        setStage("zip");
        setProgress(100);

        if (current.bytes > 0 || partJobs.length === 0)
          partJobs.push(generate(current.zip));
        const blobs = await Promise.all(partJobs);

        const ready = blobs.map((blob, i) => ({
          name:
            blobs.length === 1
              ? "pixshrink_compressed.zip"
              : `pixshrink_compressed_part${i + 1}.zip`,
          url: URL.createObjectURL(blob),
          size: blob.size,
          blob,
        }));
        urlsRef.current = ready.map((d) => d.url);
        setDownloads(ready);

        // Try to start the download ourselves. Browsers may still block it (the tap that
        // started this run is long gone), which is why the results panel has real buttons.
        for (let i = 0; i < ready.length; i++) {
          // Phones block or confuse several automatic downloads, so only start the first.
          if (i > 0 && isMobileDevice()) break;
          if (i > 0) await sleep(400);
          const a = document.createElement("a");
          a.href = ready[i].url;
          a.download = ready[i].name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }

      setShowResults(true);
      commitFiles((prev) => prev.filter((f) => !succeeded.has(f.id)));
    } catch (error) {
      console.error("Batch failed:", error);
      setRunInfo({
        ...EMPTY_RUN,
        failed: [{ name: "Batch", reason: error.message }],
      });
      setShowResults(true);
    } finally {
      setIsProcessing(false);
      setStopping(false);
    }
  };

  const shareZip = async (d) => {
    try {
      const file = new File([d.blob], d.name, { type: "application/zip" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: d.name });
      }
    } catch (err) {
      // AbortError just means the user closed the share sheet.
      if (err?.name !== "AbortError") console.warn("Share failed:", err);
    }
  };

  const percentSaved =
    originalSize > 0
      ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
      : 0;

  const formatSummary = Object.entries(runInfo.formats)
    .map(([f, n]) => `${n} ${f.toUpperCase()}`)
    .join(", ");

  const breakdown = [
    formatSummary && `Output: ${formatSummary}`,
    runInfo.imagekit > 0 && `${runInfo.imagekit} via ImageKit`,
    runInfo.local > 0 && `${runInfo.local} in your browser`,
    runInfo.kept > 0 && `${runInfo.kept} kept as original`,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasHeic = files.some((f) => isHeicFile(f.file));

  // Phones only (getMobileAdvice answers "no limit" on desktop). The limit depends on what
  // is in the queue and the chosen format, so switching format can put the queue over it.
  // Nothing is dropped: Compress is disabled until the user removes files or changes format.
  const advice = getMobileAdvice({ format, hasHeic });
  const overBy = files.length - advice.fileLimit;
  const overLimit = overBy > 0;
  const overLimitText = overLimit
    ? `This phone can process ${advice.fileLimit} images per batch with ${LIMIT_LABEL[advice.reason] || "these settings"}. Remove ${overBy} image${overBy === 1 ? "" : "s"} or switch the format.`
    : "";

  // Also blocked while HEIC copies run on phones, so a half-copied queue can't be processed.
  const isDisabled =
    files.length === 0 || isProcessing || Boolean(adding) || overLimit;

  // Strongest warning (Android HEIC to AVIF): confirm first. Nothing is blocked, the user
  // either continues or switches to WebP. Every other case starts straight away.
  const requestProcess = () => {
    if (advice.level === "strong") setConfirmOpen(true);
    else processImages();
  };
  const continueAnyway = () => {
    setConfirmOpen(false);
    processImages();
  };
  const switchToWebp = () => {
    setConfirmOpen(false);
    setFormat("webp");
  };
  const resultsReady = showResults && !isProcessing && runInfo.ok > 0;
  const resultsEmpty = showResults && !isProcessing && runInfo.ok === 0;
  const resultsFailed = resultsEmpty && !runInfo.cancelled;
  const resultsCancelled = resultsEmpty && runInfo.cancelled;

  const engineLabel =
    activeEngine === "local"
      ? "Runs in your browser"
      : activeEngine === "auto"
        ? "Cloud with local fallback"
        : "Cloud engine";

  // Based on the prop, not the live engine: the headline words animate once on mount,
  // so changing their text later would show new words invisible.
  const heroSub = imagekitAvailable
    ? "Local or cloud, you choose."
    : "Keep them on your device.";

  const scrollToTop = (e) => {
    e.preventDefault();
    const lenis = getLenis();
    if (lenis) lenis.scrollTo(0, { duration: 1.2 });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo(
        root.querySelectorAll("[data-reveal]"),
        { y: 22, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.11,
          clearProps: "transform",
        },
        0.1,
      ).fromTo(
        root.querySelectorAll(".ps-word"),
        { yPercent: 115, opacity: 1 },
        { yPercent: 0, duration: 1.3, stagger: 0.07 },
        0.2,
      );
    });

    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(root.querySelectorAll("[data-reveal], .ps-word"), {
        opacity: 1,
      });
    });

    return () => mm.revert();
  }, []);

  useEffect(() => {
    const btn = buttonRef.current;
    const wrap = buttonWrapRef.current;
    if (!btn || !wrap || isDisabled) return;
    if (
      prefersReducedMotion() ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;

    const xTo = gsap.quickTo(btn, "x", { duration: 0.6, ease: "power3.out" });
    const yTo = gsap.quickTo(btn, "y", { duration: 0.6, ease: "power3.out" });

    const onMove = (e) => {
      const r = wrap.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.04);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.12);
    };

    const leave = () => {
      xTo(0);
      yTo(0);
    };

    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerleave", leave);

    return () => {
      btn.removeEventListener("pointermove", onMove);
      btn.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(btn);
      gsap.set(btn, { clearProps: "transform" });
    };
  }, [isDisabled]);

  useEffect(() => {
    const root = resultsRef.current;
    if (!resultsReady || !root) return;

    const newEl = newSizeRef.current;
    const savedEl = savedRef.current;
    const bar = barRef.current;
    const ratio =
      originalSize > 0
        ? Math.min(1, Math.max(0, compressedSize / originalSize))
        : 0;
    const savedAbs = Math.abs(percentSaved);

    const writeFinal = () => {
      if (newEl) newEl.textContent = formatBytes(compressedSize);
      if (savedEl) savedEl.textContent = String(savedAbs);
    };

    let ctx;
    if (prefersReducedMotion()) {
      gsap.set(root, { opacity: 1 });
      if (bar) gsap.set(bar, { scaleX: ratio });
      writeFinal();
    } else {
      ctx = gsap.context(() => {
        const counter = { p: 0 };
        const timing = { duration: 1.4, delay: 0.25, ease: "power3.inOut" };

        gsap.fromTo(
          root,
          { y: 18, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            ease: "power3.out",
            clearProps: "transform",
          },
        );
        if (bar) gsap.fromTo(bar, { scaleX: 1 }, { scaleX: ratio, ...timing });
        gsap.to(counter, {
          p: 1,
          ...timing,
          onUpdate: () => {
            if (newEl) {
              newEl.textContent = formatBytes(
                Math.round(
                  originalSize + (compressedSize - originalSize) * counter.p,
                ),
              );
            }
            if (savedEl)
              savedEl.textContent = String(Math.round(savedAbs * counter.p));
          },
          onComplete: writeFinal,
        });
      }, root);
    }

    const rect = root.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      const lenis = getLenis();
      if (lenis) {
        lenis.scrollTo(root, {
          offset: -Math.max(24, (window.innerHeight - root.offsetHeight) / 2),
          duration: 1.2,
        });
      } else {
        root.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    return () => {
      ctx?.revert();
      writeFinal();
    };
  }, [resultsReady, originalSize, compressedSize, percentSaved]);

  // Animates whichever "nothing finished" panel is showing (error or cancelled).
  useEffect(() => {
    const el = errorRef.current;
    if (!resultsEmpty || !el) return;
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 1 });
      return;
    }
    const tween = gsap.fromTo(
      el,
      { y: 12, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.5,
        ease: "power3.out",
        clearProps: "transform",
      },
    );
    return () => tween.kill();
  }, [resultsEmpty]);

  return (
    <main
      ref={pageRef}
      className="relative flex-1 font-[family-name:var(--font-geist-sans)] text-neutral-900"
    >
      <PixelStyles />
      <style>{PAGE_CSS}</style>
      <WelcomeModal />

      <ConfirmCompressDialog
        open={confirmOpen}
        fileCount={files.length}
        estimate={estimateText({
          count: files.length,
          width,
          hasMaxKB: Number(maxKB) > 0 && format !== "png",
        })}
        onContinue={continueAnyway}
        onSwitch={switchToWebp}
        onClose={() => setConfirmOpen(false)}
      />

      {isProcessing && (
        <LoadingOverlay
          title={
            stage === "zip" ? "Packing your zip" : "Compressing your images"
          }
          detail={
            stage === "zip"
              ? "Almost there. Your download starts on its own."
              : `${doneCount} of ${totalCount} done${
                  doneCount > 0 && etaMs > 0 ? ` · ${formatEta(etaMs)}` : ""
                }`
          }
          progress={progress}
          onCancel={
            stage === "compress"
              ? () => {
                  cancelRef.current = true;
                  setStopping(true);
                }
              : undefined
          }
          cancelling={stopping}
        />
      )}

      <header
        data-reveal
        className="ps-reveal border-b-[3px] border-neutral-900 bg-white"
      >
        <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between px-4 py-4 sm:px-6 sm:py-5 lg:px-10 2xl:px-14">
          <a
            href="/"
            onClick={scrollToTop}
            onPointerEnter={() => setMarkActive(true)}
            onPointerLeave={() => setMarkActive(false)}
            onFocus={() => setMarkActive(true)}
            onBlur={() => setMarkActive(false)}
            aria-label="PixShrink, back to top"
            className="inline-flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 focus-visible:ring-offset-4 focus-visible:ring-offset-white"
          >
            <svg
              className="h-[1.85rem] w-[1.85rem] shrink-0 overflow-visible"
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect x="25" y="25" width="70" height="70" fill="#111111" />
              <g
                className={`transition-transform duration-200 ease-out ${markActive ? "-translate-y-2.5 translate-x-1.5" : ""}`}
              >
                <rect
                  x="5"
                  y="5"
                  width="70"
                  height="70"
                  fill="#ffffff"
                  stroke="#111111"
                  strokeWidth="6"
                  strokeLinejoin="miter"
                />
                <rect x="15" y="15" width="22" height="22" fill="#111111" />
                <rect
                  x="15"
                  y="43"
                  width="22"
                  height="22"
                  fill="var(--accent)"
                  stroke="#111111"
                  strokeWidth="4"
                  strokeLinejoin="miter"
                />
                <rect
                  x="43"
                  y="15"
                  width="22"
                  height="22"
                  fill="var(--accent)"
                  stroke="#111111"
                  strokeWidth="4"
                  strokeLinejoin="miter"
                />
              </g>
            </svg>
            <span className="font-[family-name:var(--font-pixel)] text-[1.55rem] font-semibold leading-none tracking-tight text-neutral-900 sm:text-[1.7rem]">
              PixShrink
            </span>
          </a>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12 lg:flex-row lg:items-start lg:gap-16 lg:px-10 lg:py-20 2xl:gap-24 2xl:px-14">
        <aside className="flex flex-col gap-8 lg:sticky lg:top-10 lg:w-[400px] xl:w-[460px] shrink-0">
          <div>
            <div
              data-reveal
              className="ps-reveal mb-6 inline-flex items-center gap-2 rounded-none border-[2px] border-neutral-900 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)]"
            >
              <span
                aria-hidden="true"
                className="ps-blink h-2 w-2 rounded-full bg-[var(--accent)]"
              />
              {engineLabel}
            </div>

            <h1 className="text-[clamp(2.5rem,5.5vw,4.5rem)] font-black leading-[0.95] tracking-[-0.03em] text-neutral-900">
              <span className="block">
                <Words text="Shrink images in bulk." />
              </span>
              <span className="block text-neutral-400">
                <Words text={heroSub} />
              </span>
            </h1>

            <p
              data-reveal
              className="ps-reveal mt-6 max-w-[40ch] text-base font-medium leading-relaxed text-neutral-500 sm:mt-8 sm:text-lg"
            >
              {activeEngine === "local"
                ? "Compress, resize and convert images right in your browser. Nothing is uploaded, and the only limit is your own device."
                : "Compress, resize and convert images. Files are processed by ImageKit and deleted from the cloud right after."}
            </p>
          </div>

          {/* Desktop placement of the donation card (replaces the old Ad Space box). */}
          <div data-reveal className="ps-reveal mt-8 hidden w-full lg:block">
            <DonateCard />
          </div>
        </aside>

        <div className="flex-1 space-y-14 sm:space-y-20 lg:pt-4">
          <section data-reveal className="ps-reveal">
            <StepLabel n={1}>Add your images</StepLabel>

            {/* On phones with a warning, FormatWarning (step 3) replaces this box. */}
            {hasHeic && advice.level === "none" && (
              <div className="mb-6 rounded-none border-[3px] border-neutral-900 bg-[#FFE600] p-5 shadow-[4px_4px_0_rgba(17,17,17,1)] text-left">
                <div className="flex items-start gap-4">
                  <svg
                    className="mt-0.5 h-6 w-6 shrink-0 text-neutral-900"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wide text-neutral-900">
                      HEIC Images Detected
                    </h3>
                    <p className="mt-1 text-sm font-medium text-neutral-800">
                      Operations on Apple HEIC images can be slower. Processing
                      them locally means:
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-sm font-medium text-neutral-800 space-y-1">
                      <li>Preview generation will take slightly longer.</li>
                      <li>
                        Compression runs slower compared to standard JPG/PNG
                        files.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {notice && (
              <div
                role="status"
                aria-live="polite"
                className="mb-6 rounded-none border-[3px] border-neutral-900 bg-[#FFE600] p-4 text-left shadow-[4px_4px_0_rgba(17,17,17,1)]"
              >
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-900">
                  {notice}
                </p>
              </div>
            )}

            <ImageDropzone
              files={files}
              adding={adding}
              onFilesAdded={handleFilesAdded}
              onRemoveFile={handleRemoveFile}
              onClearAll={handleClearAll}
            />
          </section>

          <section data-reveal className="ps-reveal">
            <StepLabel n={2}>Choose your settings</StepLabel>
            <CompressionControls
              width={width}
              setWidth={setWidth}
              quality={quality}
              setQuality={setQuality}
              format={format}
              setFormat={setFormat}
              imagekitAvailable={imagekitAvailable}
              engine={activeEngine}
              setEngine={setEngine}
              maxKB={maxKB}
              setMaxKB={setMaxKB}
              keepIfLarger={keepIfLarger}
              setKeepIfLarger={setKeepIfLarger}
            />
          </section>

          <section data-reveal className="ps-reveal">
            <StepLabel n={3}>Compress and download</StepLabel>
            <div className="flex flex-col items-stretch gap-6">
              <FormatWarning
                advice={advice}
                onSwitch={() => setFormat("webp")}
                className="w-full md:max-w-2xl"
              />

              <div
                ref={buttonWrapRef}
                className="w-full sm:w-auto sm:self-start"
              >
                <button
                  ref={buttonRef}
                  onClick={requestProcess}
                  disabled={isDisabled}
                  className={`group relative flex h-14 w-full items-center justify-center gap-3 rounded-none border-[3px] border-neutral-900 px-6 text-sm font-black uppercase tracking-widest transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 sm:min-w-[22rem] md:text-base ${
                    isDisabled
                      ? "pointer-events-none cursor-not-allowed bg-neutral-200 text-neutral-400 border-neutral-300"
                      : "cursor-pointer bg-[var(--accent)] text-neutral-900 neo-shadow"
                  }`}
                >
                  <span>
                    {isProcessing
                      ? "Processing Batch..."
                      : "Compress & Download Zip"}
                  </span>
                  {!isProcessing && files.length > 0 && (
                    <span className="rounded-full bg-neutral-900 px-2.5 py-1 font-mono text-[11px] leading-none text-white">
                      {files.length}
                    </span>
                  )}
                  {isProcessing ? (
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeOpacity="0.25"
                        strokeWidth="3"
                      />
                      <path
                        d="M21 12a9 9 0 0 0-9-9"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  )}
                </button>
              </div>

              {overLimit && (
                <div
                  role="alert"
                  className="w-full rounded-none border-[3px] border-neutral-900 bg-[#FFE600] p-4 text-left shadow-[4px_4px_0_rgba(17,17,17,1)] md:max-w-2xl"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-900">
                    {overLimitText}
                  </p>
                </div>
              )}

              {resultsReady && (
                <div
                  ref={resultsRef}
                  role="status"
                  aria-live="polite"
                  className="w-full rounded-none border-[3px] border-neutral-900 bg-white p-5 text-left opacity-0 shadow-[6px_6px_0_rgba(17,17,17,1)] md:max-w-2xl md:p-6 lg:p-8"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-none border-2 border-neutral-900 bg-[var(--accent)] text-neutral-900">
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wide text-neutral-900 md:text-base">
                        Compression Complete
                      </h3>
                      <p className="mt-1 text-xs font-medium text-neutral-500 md:text-sm">
                        {downloads.length > 1
                          ? `Your images are ready in ${downloads.length} zip files.`
                          : "Your zip is ready."}
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                        Original
                      </p>
                      <p className="font-mono text-sm font-medium text-neutral-400 line-through">
                        {formatBytes(originalSize)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold uppercase tracking-widest text-neutral-900">
                        New Size
                      </p>
                      <p
                        ref={newSizeRef}
                        className="font-mono text-3xl font-black tracking-tight text-neutral-900 md:text-4xl"
                      >
                        {formatBytes(compressedSize)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 h-3 w-full overflow-hidden rounded-none border-[2px] border-neutral-900 bg-neutral-100">
                    <div
                      ref={barRef}
                      className={`h-full w-full origin-left ${percentSaved >= 0 ? "bg-[var(--accent)]" : "bg-neutral-800"}`}
                    />
                  </div>

                  <p className="mt-4 text-sm font-medium text-neutral-500">
                    <span className="font-black text-neutral-900">
                      {percentSaved >= 0 ? "Saved" : "Larger by"}{" "}
                      <span ref={savedRef}>{Math.abs(percentSaved)}</span>%
                    </span>
                    {percentSaved >= 0 && " of total size"}
                  </p>

                  {breakdown && (
                    <p className="mt-5 border-t-2 border-neutral-100 pt-4 font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                      {breakdown}
                    </p>
                  )}

                  {downloads.length > 0 && (
                    <div className="mt-5 border-t-2 border-neutral-100 pt-5">
                      <p className="text-xs font-medium text-neutral-500">
                        The download should start on its own. If it didn&apos;t,
                        use the {downloads.length > 1 ? "buttons" : "button"}{" "}
                        below.
                      </p>
                      <div className="mt-3 flex flex-col gap-3">
                        {downloads.map((d) => (
                          <div key={d.name} className="flex gap-2">
                            <a
                              href={d.url}
                              download={d.name}
                              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-none border-[3px] border-neutral-900 bg-[var(--accent)] px-4 py-3 text-xs font-black uppercase tracking-wider text-neutral-900 shadow-[3px_3px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[5px_5px_0_rgba(17,17,17,1)] active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30"
                            >
                              <span className="truncate">{d.name}</span>
                              <span className="shrink-0 font-mono text-[11px]">
                                {formatBytes(d.size)}
                              </span>
                            </a>
                            {canShareZip && (
                              <button
                                type="button"
                                onClick={() => shareZip(d)}
                                className="shrink-0 cursor-pointer rounded-none border-[3px] border-neutral-900 bg-white px-4 py-3 text-xs font-black uppercase tracking-wider text-neutral-900 shadow-[3px_3px_0_rgba(17,17,17,1)] transition-transform active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30"
                              >
                                Share
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {runInfo.missed.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-amber-600">
                      {runInfo.missed.length} image
                      {runInfo.missed.length === 1 ? " is" : "s are"} still
                      above the {runInfo.limitKB} KB limit:{" "}
                      {runInfo.missed
                        .slice(0, 3)
                        .map((m) => `${m.name} (${formatBytes(m.size, 0)})`)
                        .join(", ")}
                      {runInfo.missed.length > 3
                        ? ` and ${runInfo.missed.length - 3} more`
                        : ""}
                      . Try a smaller width or a different format.
                    </p>
                  )}
                  {runInfo.stopped > 0 && (
                    <p className="mt-3 text-xs font-medium text-amber-600">
                      Stopped early. {runInfo.stopped} image
                      {runInfo.stopped === 1 ? "" : "s"} left in the queue.
                    </p>
                  )}
                  {runInfo.unreadable.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-amber-600">
                      {unreadableMessage(runInfo.unreadable)}
                    </p>
                  )}
                  {runInfo.failed.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-red-600">
                      {runInfo.failed.length} failed and stayed in the queue so
                      you can retry:{" "}
                      {runInfo.failed
                        .slice(0, 3)
                        .map((f) => f.name)
                        .join(", ")}
                      {runInfo.failed.length > 3
                        ? ` and ${runInfo.failed.length - 3} more`
                        : ""}
                      . First error: {runInfo.failed[0].reason}
                    </p>
                  )}
                </div>
              )}

              {resultsCancelled && (
                <div
                  ref={errorRef}
                  role="status"
                  aria-live="polite"
                  className="w-full rounded-none border-[3px] border-neutral-900 bg-white p-5 text-left opacity-0 shadow-[6px_6px_0_rgba(17,17,17,1)] md:max-w-2xl md:p-6"
                >
                  <h3 className="text-sm font-black uppercase tracking-wide text-neutral-900 md:text-base">
                    Cancelled
                  </h3>
                  <p className="mt-2 text-xs font-medium text-neutral-500 md:text-sm">
                    No images were finished, and all of them are still in the
                    queue.
                    {runInfo.failed.length > 0 &&
                      ` ${runInfo.failed.length} failed before you cancelled. First error: ${runInfo.failed[0].reason}`}
                  </p>
                </div>
              )}

              {resultsFailed && (
                <div
                  ref={errorRef}
                  role="alert"
                  className="w-full rounded-none border-[3px] border-neutral-900 bg-red-50 p-5 text-left opacity-0 shadow-[6px_6px_0_rgba(17,17,17,1)] md:max-w-2xl md:p-6"
                >
                  <h3 className="text-sm font-black uppercase tracking-wide text-red-600 md:text-base">
                    Nothing could be compressed
                  </h3>
                  <p className="mt-2 text-xs font-medium text-red-600 md:text-sm">
                    {runInfo.failed.length > 0
                      ? runInfo.failed[0].reason
                      : activeEngine === "imagekit"
                        ? "ImageKit rejected every file. If your monthly quota is used up, switch the engine to Local or Auto and try again."
                        : "Nothing was processed."}
                  </p>
                </div>
              )}

              {/* Mobile placement of the donation card: the sidebar is hidden on small screens. */}
              <div className="w-full md:max-w-md lg:hidden">
                <DonateCard />
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
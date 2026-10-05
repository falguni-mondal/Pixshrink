"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import CompressionControls from "@/components/CompressionControls";
import ImageDropzone from "@/components/ImageDropzone";
import WelcomeModal from "@/components/WelcomeModal";
import { LoadingOverlay, PixelMosaic, PixelStyles } from "@/components/PixelLoader";
import { getLenis } from "@/components/SmoothScroll";
import { compressLocally } from "@/lib/localCompress";

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const stripExt = (name) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
};

// Exact byte size of a base64 string (accounts for "=" padding)
const base64Size = (b64) =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

// Prevents two files with the same name from overwriting each other inside the zip
const makeNameRegistry = () => {
  const used = new Set();
  return (name) => {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    let n = 1;
    while (used.has(candidate.toLowerCase())) candidate = `${base} (${n++})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
};

// Start a new zip after ~250 MB of output so memory stays bounded on very large batches
const PART_LIMIT = 250 * 1024 * 1024;

// How many images to process at once. Fewer on weaker devices to avoid running out of memory.
const getConcurrency = () => {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8; // Chromium only; assume enough elsewhere
  return Math.max(1, Math.min(4, Math.floor(cores / 2), memory <= 4 ? 2 : 4));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// crypto.randomUUID only exists on HTTPS or localhost. Opening the dev server from a phone
// over http://192.168.x.x is an insecure origin, so it needs a fallback.
let idCounter = 0;
const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------------------
// Design helpers (UI only, no effect on compression logic)
// ---------------------------------------------------------------------------------------
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Small scoped sheet: hero reveal masks, a pixel-style blink for the status square, and a
// failsafe that reveals everything after 3.5s even if JavaScript is slow or blocked.
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

// Splits a sentence into words that rise out of a mask, one after another
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

// The steps really are a sequence (add, adjust, export), so they stay numbered
function StepLabel({ n, children }) {
  return (
    <div className="mb-4 flex items-center gap-3 sm:mb-5">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-300 font-[family-name:var(--font-pixel)] text-sm leading-none text-neutral-900"
      >
        {n}
      </span>
      <h2 className="text-sm font-medium text-neutral-900 sm:text-base">{children}</h2>
      <span aria-hidden="true" className="h-px flex-1 bg-neutral-200" />
    </div>
  );
}

export default function CompressorApp({ imagekitAvailable = false }) {
  // State is an array of objects: { id: string, file: File }
  const [files, setFiles] = useState([]);
  const [width, setWidth] = useState(1080);
  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState("webp");

  // engine = "imagekit" | "local" | "auto". Without ImageKit configured it is always "local".
  const [engine, setEngine] = useState(imagekitAvailable ? "imagekit" : "local");
  const activeEngine = imagekitAvailable ? engine : "local";
  const [maxKB, setMaxKB] = useState("");
  const [keepIfLarger, setKeepIfLarger] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState("compress"); // "compress" | "zip"
  const [progress, setProgress] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const [runInfo, setRunInfo] = useState({ ok: 0, imagekit: 0, local: 0, kept: 0, failed: [], stopped: 0 });

  const cancelRef = useRef(false);
  const urlsRef = useRef([]);

  // Refs used only by the GSAP animations
  const pageRef = useRef(null);
  const buttonWrapRef = useRef(null);
  const buttonRef = useRef(null);
  const resultsRef = useRef(null);
  const errorRef = useRef(null);
  const newSizeRef = useRef(null);
  const savedRef = useRef(null);
  const barRef = useRef(null);

  // Stable callbacks so the memoized dropzone and previews don't re-render needlessly
  const handleFilesAdded = useCallback((newFilesArray) => {
    const filesWithIds = newFilesArray.map((file) => ({
      id: makeId(),
      file: file,
    }));
    setFiles((prev) => [...prev, ...filesWithIds]);
    setShowResults(false);
  }, []);

  const handleRemoveFile = useCallback((idToRemove) => {
    setFiles((prev) => prev.filter((f) => f.id !== idToRemove));
  }, []);

  const handleClearAll = useCallback(() => {
    setFiles([]);
  }, []);

  // Warn before closing or refreshing the tab mid-run, since work would be lost
  useEffect(() => {
    if (!isProcessing) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isProcessing]);

  // Release zip memory when leaving the page
  useEffect(() => {
    return () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const processImages = async () => {
    if (files.length === 0) return;
    const queue = files; // snapshot of this run

    cancelRef.current = false;
    setStopping(false);
    setStage("compress");
    setDoneCount(0);
    setTotalCount(queue.length);
    setProgress(0);
    setShowResults(false);
    setIsProcessing(true);

    // Free the previous run's zips
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
    setDownloads([]);

    try {
      // Loaded on demand so it doesn't weigh down the first page load
      const { default: JSZip } = await import("jszip");

      const uniqueName = makeNameRegistry();
      // A max file size is only meaningful for lossy formats, and it runs in the browser
      const targetKB = Number(maxKB) > 0 && format !== "png" ? Number(maxKB) : 0;

      const stats = { imagekit: 0, local: 0, kept: 0 };
      const succeeded = new Set();
      const failed = [];
      let completedCount = 0;
      let okOriginalBytes = 0;
      let totalCompressedBytes = 0;

      // Zips are finalized in parts of ~250 MB. "STORE" skips re-compression,
      // since images are already compressed and DEFLATE would only burn CPU.
      let current = { zip: new JSZip(), bytes: 0 };
      const partJobs = [];
      const generate = (zip) => zip.generateAsync({ type: "blob", compression: "STORE" });
      const addToZip = (name, content, options, size) => {
        current.zip.file(uniqueName(name), content, options);
        current.bytes += size;
        if (current.bytes >= PART_LIMIT) {
          const full = current;
          current = { zip: new JSZip(), bytes: 0 };
          partJobs.push(generate(full.zip));
        }
      };

      // ENGINE 1: ImageKit (your original request, unchanged)
      const viaImageKit = async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("width", width.toString());
        formData.append("quality", quality.toString());
        formData.append("format", format);

        const res = await fetch("/api/compress", { method: "POST", body: formData });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Unknown error");

        return {
          name: data.fileName,
          content: data.data,
          options: { base64: true },
          size: base64Size(data.data),
        };
      };

      // ENGINE 2: Local (runs in a Web Worker in your browser, no quota)
      const viaLocal = async (file, allowFallback) => {
        const { blob, format: usedFormat } = await compressLocally(file, {
          width, quality, format, maxKB: targetKB, allowFallback,
        });
        return {
          name: `${stripExt(file.name)}_compressed.${usedFormat}`,
          content: blob,
          options: {},
          size: blob.size,
        };
      };

      const handleOne = async (obj) => {
        try {
          let out;
          let used;

          if (activeEngine === "local" || targetKB) {
            out = await viaLocal(obj.file, false);
            used = "local";
          } else if (activeEngine === "auto") {
            try {
              out = await viaImageKit(obj.file);
              used = "imagekit";
            } catch (err) {
              console.warn(`ImageKit failed for ${obj.file.name}, using local engine:`, err.message);
              out = await viaLocal(obj.file, true);
              used = "local";
            }
          } else {
            out = await viaImageKit(obj.file);
            used = "imagekit";
          }

          if (keepIfLarger && out.size >= obj.file.size) {
            addToZip(obj.file.name, obj.file, {}, obj.file.size);
            totalCompressedBytes += obj.file.size;
            stats.kept++;
          } else {
            addToZip(out.name, out.content, out.options, out.size);
            totalCompressedBytes += out.size;
            stats[used]++;
          }
          okOriginalBytes += obj.file.size;
          succeeded.add(obj.id);
        } catch (error) {
          console.error(`Error processing ${obj.file.name}:`, error.message);
          failed.push({ name: obj.file.name, reason: error.message });
        } finally {
          completedCount++;
          setDoneCount(completedCount);
          setProgress((completedCount / queue.length) * 100);
        }
      };

      // A small pool of runners pulls the next file as soon as one finishes
      let cursor = 0;
      const runner = async () => {
        while (!cancelRef.current && cursor < queue.length) {
          const obj = queue[cursor++];
          await handleOne(obj);
        }
      };
      await Promise.all(Array.from({ length: getConcurrency() }, runner));

      const okCount = succeeded.size;
      const notAttempted = cancelRef.current ? queue.length - succeeded.size - failed.length : 0;

      // Only successful files count toward the savings numbers
      setOriginalSize(okOriginalBytes);
      setCompressedSize(totalCompressedBytes);
      setRunInfo({ ok: okCount, ...stats, failed, stopped: notAttempted });

      if (okCount > 0) {
        setStage("zip");
        setProgress(100);

        if (current.bytes > 0 || partJobs.length === 0) partJobs.push(generate(current.zip));
        const blobs = await Promise.all(partJobs);

        const ready = blobs.map((blob, i) => ({
          name:
            blobs.length === 1
              ? "pixshrink_compressed.zip"
              : `pixshrink_compressed_part${i + 1}.zip`,
          url: URL.createObjectURL(blob),
        }));
        urlsRef.current = ready.map((d) => d.url);
        setDownloads(ready);

        // Browsers may ask permission for multiple downloads, so space them out a little
        for (let i = 0; i < ready.length; i++) {
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
      // Finished files leave the queue; failed or skipped ones stay so you can retry them
      setFiles((prev) => prev.filter((f) => !succeeded.has(f.id)));
    } catch (error) {
      console.error("Batch failed:", error);
      setRunInfo({
        ok: 0, imagekit: 0, local: 0, kept: 0, stopped: 0,
        failed: [{ name: "Batch", reason: error.message }],
      });
      setShowResults(true);
    } finally {
      setIsProcessing(false);
      setStopping(false);
    }
  };

  const percentSaved = originalSize > 0
    ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
    : 0;

  const breakdown = [
    runInfo.imagekit > 0 && `${runInfo.imagekit} via ImageKit`,
    runInfo.local > 0 && `${runInfo.local} in your browser`,
    runInfo.kept > 0 && `${runInfo.kept} kept as original`,
  ].filter(Boolean).join(" · ");

  // -------------------------------------------------------------------------------------
  // Design + GSAP (everything below only affects how the page looks and moves)
  // -------------------------------------------------------------------------------------
  const isDisabled = files.length === 0 || isProcessing;
  const resultsReady = showResults && !isProcessing && runInfo.ok > 0;
  const resultsFailed = showResults && !isProcessing && runInfo.ok === 0;
  const engineLabel =
    activeEngine === "local"
      ? "Runs in your browser"
      : activeEngine === "auto"
      ? "Cloud with local fallback"
      : "Cloud engine";

  // The logo mark comes alive while the pointer or keyboard focus is on the wordmark
  const [markActive, setMarkActive] = useState(false);

  const scrollToTop = (e) => {
    e.preventDefault();
    const lenis = getLenis();
    if (lenis) lenis.scrollTo(0, { duration: 1.2 });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // One orchestrated page-load moment: header, status, headline words, then the tool
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo(
        root.querySelectorAll("[data-reveal]"),
        { y: 22, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, stagger: 0.11, clearProps: "transform" },
        0.1
      ).fromTo(
        root.querySelectorAll(".ps-word"),
        { yPercent: 115, opacity: 1 },
        { yPercent: 0, duration: 1.3, stagger: 0.07 },
        0.2
      );
    });

    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(root.querySelectorAll("[data-reveal], .ps-word"), { opacity: 1 });
    });

    return () => mm.revert();
  }, []);

  // Subtle magnetic pull on the main button (mouse devices only, never while disabled).
  useEffect(() => {
    const btn = buttonRef.current;
    const wrap = buttonWrapRef.current;
    if (!btn || !wrap || isDisabled) return;
    if (prefersReducedMotion() || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const xTo = gsap.quickTo(btn, "x", { duration: 0.6, ease: "power3.out" });
    const yTo = gsap.quickTo(btn, "y", { duration: 0.6, ease: "power3.out" });

    const onMove = (e) => {
      const r = wrap.getBoundingClientRect(); // measured on the static wrapper, so no feedback loop
      xTo((e.clientX - (r.left + r.width / 2)) * 0.04);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.12);
    };
    const press = () => gsap.to(btn, { scale: 0.98, duration: 0.15, ease: "power2.out", overwrite: "auto" });
    const release = () =>
      gsap.to(btn, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.6)", overwrite: "auto" });
    const leave = () => {
      xTo(0);
      yTo(0);
      release();
    };

    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerleave", leave);
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);

    return () => {
      btn.removeEventListener("pointermove", onMove);
      btn.removeEventListener("pointerleave", leave);
      btn.removeEventListener("pointerdown", press);
      btn.removeEventListener("pointerup", release);
      gsap.killTweensOf(btn);
      gsap.set(btn, { clearProps: "transform" });
    };
  }, [isDisabled]);

  // Results panel: slide in, count the new size down, fill the bar, bring it into view if needed.
  useEffect(() => {
    const root = resultsRef.current;
    if (!resultsReady || !root) return;

    const newEl = newSizeRef.current;
    const savedEl = savedRef.current;
    const bar = barRef.current;
    const ratio = originalSize > 0 ? Math.min(1, Math.max(0, compressedSize / originalSize)) : 0;
    const savedAbs = Math.abs(percentSaved);

    // Always leave the exact final numbers in the DOM, however the animation ends.
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
          { y: 0, opacity: 1, duration: 0.7, ease: "power3.out", clearProps: "transform" }
        );
        if (bar) gsap.fromTo(bar, { scaleX: 1 }, { scaleX: ratio, ...timing });
        gsap.to(counter, {
          p: 1,
          ...timing,
          onUpdate: () => {
            if (newEl) {
              newEl.textContent = formatBytes(
                Math.round(originalSize + (compressedSize - originalSize) * counter.p)
              );
            }
            if (savedEl) savedEl.textContent = String(Math.round(savedAbs * counter.p));
          },
          onComplete: writeFinal,
        });
      }, root);
    }

    // On small screens the panel can land below the fold, so glide down to it.
    const rect = root.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      const lenis = getLenis();
      if (lenis) {
        lenis.scrollTo(root, { offset: -Math.max(24, (window.innerHeight - root.offsetHeight) / 2), duration: 1.2 });
      } else {
        root.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    return () => {
      ctx?.revert();
      writeFinal();
    };
  }, [resultsReady, originalSize, compressedSize, percentSaved]);

  // Error panel entrance
  useEffect(() => {
    const el = errorRef.current;
    if (!resultsFailed || !el) return;
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 1 });
      return;
    }
    const tween = gsap.fromTo(
      el,
      { y: 12, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, ease: "power3.out", clearProps: "transform" }
    );
    return () => tween.kill();
  }, [resultsFailed]);

  return (
    <main
      ref={pageRef}
      className="relative flex-1 font-[family-name:var(--font-geist-sans)] text-neutral-900"
    >
      <PixelStyles />
      <style>{PAGE_CSS}</style>
      <WelcomeModal />
      {isProcessing && (
        <LoadingOverlay
          title={stage === "zip" ? "Packing your zip" : "Compressing your images"}
          detail={
            stage === "zip"
              ? "Almost there. Your download starts on its own."
              : `${doneCount} of ${totalCount} done`
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

      {/* Header: full-width hairline, content aligned to the page container */}
      <header data-reveal className="ps-reveal border-b border-neutral-200/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5 lg:px-10 2xl:max-w-[76rem]">
          <a
            href="/"
            onClick={scrollToTop}
            onPointerEnter={() => setMarkActive(true)}
            onPointerLeave={() => setMarkActive(false)}
            onFocus={() => setMarkActive(true)}
            onBlur={() => setMarkActive(false)}
            aria-label="PixShrink, back to top"
            className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f7f6f3]"
          >
            <PixelMosaic size={28} grid={4} animated={markActive} />
            <span className="font-[family-name:var(--font-pixel)] text-[1.55rem] font-semibold leading-none tracking-tight text-neutral-900 sm:text-[1.7rem]">
              PixShrink
            </span>
          </a>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10 2xl:max-w-[76rem]">
        {/* Hero */}
        <section className="pb-12 pt-10 sm:pb-14 sm:pt-14 md:pt-20 lg:pb-16 lg:pt-24">
          <div
            data-reveal
            className="ps-reveal inline-flex items-center gap-2 rounded-full border border-neutral-300/80 px-3 py-1 text-xs font-medium text-neutral-600"
          >
            <span aria-hidden="true" className="ps-blink h-1.5 w-1.5 bg-emerald-500" />
            {engineLabel}
          </div>

          <h1 className="mt-6 text-[clamp(2.25rem,6.6vw,5rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-neutral-900 sm:mt-8">
            <span className="block">
              <Words text="Shrink images in bulk." />
            </span>
            <span className="block text-neutral-500">
              <Words text="Keep them on your device." />
            </span>
          </h1>

          <p
            data-reveal
            className="ps-reveal mt-6 max-w-[46ch] text-base leading-relaxed text-neutral-500 sm:mt-8 sm:text-lg"
          >
            {activeEngine === "local"
              ? "Compress, resize and convert images right in your browser. Nothing is uploaded, and the only limit is your own device."
              : "Compress, resize and convert images. Files are processed by ImageKit and deleted from the cloud right after."}
          </p>
        </section>

        {/* Tool: three numbered steps on the open page, no enclosing card */}
        <div className="space-y-12 pb-24 sm:space-y-14 sm:pb-28 md:space-y-16">
          <section data-reveal className="ps-reveal">
            <StepLabel n={1}>Add your images</StepLabel>
            <ImageDropzone
              files={files}
              onFilesAdded={handleFilesAdded}
              onRemoveFile={handleRemoveFile}
              onClearAll={handleClearAll}
            />
          </section>

          <section data-reveal className="ps-reveal">
            <StepLabel n={2}>Choose your settings</StepLabel>
            <CompressionControls
              width={width} setWidth={setWidth}
              quality={quality} setQuality={setQuality}
              format={format} setFormat={setFormat}
              imagekitAvailable={imagekitAvailable}
              engine={activeEngine} setEngine={setEngine}
              maxKB={maxKB} setMaxKB={setMaxKB}
              keepIfLarger={keepIfLarger} setKeepIfLarger={setKeepIfLarger}
            />
          </section>

          <section data-reveal className="ps-reveal">
            <StepLabel n={3}>Compress and download</StepLabel>
            <div className="flex flex-col items-stretch gap-6">
              <div ref={buttonWrapRef} className="w-full sm:w-auto sm:self-start">
                <button
                  ref={buttonRef}
                  onClick={processImages}
                  disabled={isDisabled}
                  className={`group relative flex h-14 w-full items-center justify-center gap-3 rounded-2xl px-6 text-sm font-medium transition-[background-color,box-shadow,color] duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-neutral-300 sm:min-w-[22rem] md:text-base ${
                    isDisabled
                      ? "pointer-events-none cursor-not-allowed bg-neutral-200 text-neutral-400"
                      : "cursor-pointer bg-neutral-900 text-white shadow-[0_14px_32px_-12px_rgba(0,0,0,0.55)] hover:bg-black"
                  }`}
                >
                  <span>{isProcessing ? "Processing Batch..." : "Compress & Download Zip"}</span>
                  {!isProcessing && files.length > 0 && (
                    <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[11px] leading-none">
                      {files.length}
                    </span>
                  )}
                  {isProcessing ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  )}
                </button>
              </div>

              {resultsReady && (
                <div
                  ref={resultsRef}
                  role="status"
                  aria-live="polite"
                  className="w-full rounded-2xl border border-neutral-200 bg-neutral-50/70 p-5 text-left opacity-0 md:max-w-2xl md:p-6"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 md:text-base">Compression Complete!</h3>
                      <p className="text-xs text-neutral-500 md:text-sm">Your zip file has been downloaded.</p>
                    </div>
                  </div>

                  <div className="mt-5 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs text-neutral-400">Original</p>
                      <p className="font-mono text-sm text-neutral-400 line-through">{formatBytes(originalSize)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-emerald-600">New Size</p>
                      <p ref={newSizeRef} className="font-mono text-2xl font-semibold tracking-tight text-neutral-900 md:text-3xl">
                        {formatBytes(compressedSize)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                    <div
                      ref={barRef}
                      className={`h-full w-full origin-left rounded-full ${percentSaved >= 0 ? "bg-emerald-500" : "bg-amber-500"}`}
                    />
                  </div>

                  <p className="mt-3 text-sm text-neutral-500">
                    <span className="font-semibold text-neutral-900">
                      {percentSaved >= 0 ? "Saved" : "Larger by"} <span ref={savedRef}>{Math.abs(percentSaved)}</span>%
                    </span>
                    {percentSaved >= 0 && " of total size"}
                  </p>

                  {breakdown && (
                    <p className="mt-4 border-t border-neutral-200 pt-4 font-mono text-[11px] text-neutral-500">{breakdown}</p>
                  )}

                  {downloads.length > 0 && (
                    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                      <span>Download didn&apos;t start?</span>
                      {downloads.map((d) => (
                        <a
                          key={d.name}
                          href={d.url}
                          download={d.name}
                          className="font-medium text-neutral-900 underline underline-offset-2 transition-colors hover:text-black"
                        >
                          {d.name}
                        </a>
                      ))}
                    </p>
                  )}

                  {runInfo.stopped > 0 && (
                    <p className="mt-3 text-xs text-amber-700">
                      Stopped early. {runInfo.stopped} image{runInfo.stopped === 1 ? "" : "s"} left in the queue.
                    </p>
                  )}
                  {runInfo.failed.length > 0 && (
                    <p className="mt-3 text-xs text-amber-700">
                      {runInfo.failed.length} failed and stayed in the queue so you can retry:{" "}
                      {runInfo.failed.slice(0, 3).map((f) => f.name).join(", ")}
                      {runInfo.failed.length > 3 ? ` and ${runInfo.failed.length - 3} more` : ""}.
                      {" "}First error: {runInfo.failed[0].reason}
                    </p>
                  )}
                </div>
              )}

              {resultsFailed && (
                <div
                  ref={errorRef}
                  role="alert"
                  className="w-full rounded-2xl border border-red-200 bg-red-50/60 p-5 text-left opacity-0 md:max-w-2xl md:p-6"
                >
                  <h3 className="text-sm font-semibold text-red-800 md:text-base">Nothing could be compressed</h3>
                  <p className="mt-1 text-xs text-red-600 md:text-sm">
                    {runInfo.failed.length > 0
                      ? runInfo.failed[0].reason
                      : activeEngine === "imagekit"
                      ? "ImageKit rejected every file. If your monthly quota is used up, switch the engine to Local or Auto and try again."
                      : "Nothing was processed."}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
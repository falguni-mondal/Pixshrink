"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import CompressionControls from "@/components/CompressionControls";
import ImageDropzone from "@/components/ImageDropzone";
import WelcomeModal from "@/components/WelcomeModal";
import { LoadingOverlay, PixelStyles } from "@/components/PixelLoader";
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

const base64Size = (b64) =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

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

const isMobileDevice = () => {
  if (typeof window === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
};

// Start a new zip after 40MB on mobile, or 250MB on desktop.
const getPartLimit = () => isMobileDevice() ? 40 * 1024 * 1024 : 250 * 1024 * 1024;

const getConcurrency = () => {
  if (isMobileDevice()) return 1;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : 4;
  return Math.max(1, Math.min(3, Math.floor(cores / 2), memory <= 4 ? 2 : 3));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let idCounter = 0;
const makeId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  const [engine, setEngine] = useState(imagekitAvailable ? "imagekit" : "local");
  const activeEngine = imagekitAvailable ? engine : "local";
  const [maxKB, setMaxKB] = useState("");
  const [keepIfLarger, setKeepIfLarger] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState("compress");
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

  const pageRef = useRef(null);
  const buttonWrapRef = useRef(null);
  const buttonRef = useRef(null);
  const resultsRef = useRef(null);
  const errorRef = useRef(null);
  const newSizeRef = useRef(null);
  const savedRef = useRef(null);
  const barRef = useRef(null);

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

  useEffect(() => {
    if (!isProcessing) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isProcessing]);

  useEffect(() => {
    return () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const processImages = async () => {
    if (files.length === 0) return;
    const queue = files;

    cancelRef.current = false;
    setStopping(false);
    setStage("compress");
    setDoneCount(0);
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
      const targetKB = Number(maxKB) > 0 && format !== "png" ? Number(maxKB) : 0;

      const stats = { imagekit: 0, local: 0, kept: 0 };
      const succeeded = new Set();
      const failed = [];
      let completedCount = 0;
      let okOriginalBytes = 0;
      let totalCompressedBytes = 0;

      let current = { zip: new JSZip(), bytes: 0 };
      const partJobs = [];
      const generate = (zip) => zip.generateAsync({ type: "blob", compression: "STORE" });
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
          
          // ADAPTIVE GARBAGE COLLECTION YIELD
          if (isMobileDevice()) {
            // Massive files (> 5MB) get a 600ms sleep to ensure iOS drops the RAM. Normal files get 150ms.
            const sleepTime = obj.file.size > 5 * 1024 * 1024 ? 600 : 150;
            await sleep(sleepTime);
          } else {
            await sleep(10); // Tiny tick for desktop just to keep the UI smooth
          }
        }
      };

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

  const hasHeic = files.some(
    (f) =>
      f.file.name.toLowerCase().endsWith(".heic") ||
      f.file.name.toLowerCase().endsWith(".heif") ||
      f.file.type === "image/heic" ||
      f.file.type === "image/heif"
  );

  const isDisabled = files.length === 0 || isProcessing;
  const resultsReady = showResults && !isProcessing && runInfo.ok > 0;
  const resultsFailed = showResults && !isProcessing && runInfo.ok === 0;
  
  const engineLabel =
    activeEngine === "local"
      ? "Runs in your browser"
      : activeEngine === "auto"
      ? "Cloud with local fallback"
      : "Cloud engine";

  const [markActive, setMarkActive] = useState(false);

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

  useEffect(() => {
    const btn = buttonRef.current;
    const wrap = buttonWrapRef.current;
    if (!btn || !wrap || isDisabled) return;
    if (prefersReducedMotion() || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

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
    const ratio = originalSize > 0 ? Math.min(1, Math.max(0, compressedSize / originalSize)) : 0;
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

      <header data-reveal className="ps-reveal border-b-[3px] border-neutral-900 bg-white">
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
              <g className={`transition-transform duration-200 ease-out ${markActive ? "-translate-y-2.5 translate-x-1.5" : ""}`}>
                <rect x="5" y="5" width="70" height="70" fill="#ffffff" stroke="#111111" strokeWidth="6" strokeLinejoin="miter" />
                <rect x="15" y="15" width="22" height="22" fill="#111111" />
                <rect x="15" y="43" width="22" height="22" fill="var(--accent)" stroke="#111111" strokeWidth="4" strokeLinejoin="miter" />
                <rect x="43" y="15" width="22" height="22" fill="var(--accent)" stroke="#111111" strokeWidth="4" strokeLinejoin="miter" />
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
              <span aria-hidden="true" className="ps-blink h-2 w-2 rounded-full bg-[var(--accent)]" />
              {engineLabel}
            </div>

            <h1 className="text-[clamp(2.5rem,5.5vw,4.5rem)] font-black leading-[0.95] tracking-[-0.03em] text-neutral-900">
              <span className="block">
                <Words text="Shrink images in bulk." />
              </span>
              <span className="block text-neutral-400">
                <Words text="Keep them on your device." />
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

          <div data-reveal className="ps-reveal mt-8 hidden w-full lg:block">
            <div className="flex h-[400px] w-full flex-col items-center justify-center rounded-none border-[3px] border-neutral-900 bg-neutral-100 shadow-[6px_6px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 hover:shadow-[10px_10px_0_rgba(17,17,17,1)]">
              <span className="font-mono text-xs font-bold uppercase tracking-widest text-neutral-400">Ad Space</span>
              <span className="mt-2 max-w-[200px] text-center text-xs text-neutral-400">Reserved for future high-visibility vertical placement</span>
            </div>
          </div>
        </aside>

        <div className="flex-1 space-y-14 sm:space-y-20 lg:pt-4">
          
          <section data-reveal className="ps-reveal">
            <StepLabel n={1}>Add your images</StepLabel>
            
            {hasHeic && (
              <div className="mb-6 rounded-none border-[3px] border-neutral-900 bg-[#FFE600] p-5 shadow-[4px_4px_0_rgba(17,17,17,1)] text-left">
                <div className="flex items-start gap-4">
                  <svg className="mt-0.5 h-6 w-6 shrink-0 text-neutral-900" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wide text-neutral-900">HEIC Images Detected</h3>
                    <p className="mt-1 text-sm font-medium text-neutral-800">
                      Operations on Apple HEIC images can be slower. Processing them locally means:
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-sm font-medium text-neutral-800 space-y-1">
                      <li>Preview generation will take slightly longer.</li>
                      <li>Compression runs slower compared to standard JPG/PNG files.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

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
                  className={`group relative flex h-14 w-full items-center justify-center gap-3 rounded-none border-[3px] border-neutral-900 px-6 text-sm font-black uppercase tracking-widest transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 sm:min-w-[22rem] md:text-base ${
                    isDisabled
                      ? "pointer-events-none cursor-not-allowed bg-neutral-200 text-neutral-400 border-neutral-300"
                      : "cursor-pointer bg-[var(--accent)] text-neutral-900 neo-shadow"
                  }`}
                >
                  <span>{isProcessing ? "Processing Batch..." : "Compress & Download Zip"}</span>
                  {!isProcessing && files.length > 0 && (
                    <span className="rounded-full bg-neutral-900 px-2.5 py-1 font-mono text-[11px] leading-none text-white">
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

              {resultsReady && (
                <div
                  ref={resultsRef}
                  role="status"
                  aria-live="polite"
                  className="w-full rounded-none border-[3px] border-neutral-900 bg-white p-5 text-left opacity-0 shadow-[6px_6px_0_rgba(17,17,17,1)] md:max-w-2xl md:p-6 lg:p-8"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-none border-2 border-neutral-900 bg-[var(--accent)] text-neutral-900">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wide text-neutral-900 md:text-base">Compression Complete</h3>
                      <p className="mt-1 text-xs font-medium text-neutral-500 md:text-sm">Your zip file has been downloaded.</p>
                    </div>
                  </div>

                  <div className="mt-8 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">Original</p>
                      <p className="font-mono text-sm font-medium text-neutral-400 line-through">{formatBytes(originalSize)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold uppercase tracking-widest text-neutral-900">New Size</p>
                      <p ref={newSizeRef} className="font-mono text-3xl font-black tracking-tight text-neutral-900 md:text-4xl">
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
                      {percentSaved >= 0 ? "Saved" : "Larger by"} <span ref={savedRef}>{Math.abs(percentSaved)}</span>%
                    </span>
                    {percentSaved >= 0 && " of total size"}
                  </p>

                  {breakdown && (
                    <p className="mt-5 border-t-2 border-neutral-100 pt-4 font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-400">{breakdown}</p>
                  )}

                  {downloads.length > 0 && (
                    <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-neutral-500">
                      <span>Download didn&apos;t start?</span>
                      {downloads.map((d) => (
                        <a
                          key={d.name}
                          href={d.url}
                          download={d.name}
                          className="font-bold text-neutral-900 underline decoration-2 underline-offset-4 transition-colors hover:text-[var(--accent)]"
                        >
                          {d.name}
                        </a>
                      ))}
                    </p>
                  )}

                  {runInfo.stopped > 0 && (
                    <p className="mt-3 text-xs font-medium text-amber-600">
                      Stopped early. {runInfo.stopped} image{runInfo.stopped === 1 ? "" : "s"} left in the queue.
                    </p>
                  )}
                  {runInfo.failed.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-red-600">
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
                  className="w-full rounded-none border-[3px] border-neutral-900 bg-red-50 p-5 text-left opacity-0 shadow-[6px_6px_0_rgba(17,17,17,1)] md:max-w-2xl md:p-6"
                >
                  <h3 className="text-sm font-black uppercase tracking-wide text-red-600 md:text-base">Nothing could be compressed</h3>
                  <p className="mt-2 text-xs font-medium text-red-600 md:text-sm">
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
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CompressionControls from "@/components/CompressionControls";
import ImageDropzone from "@/components/ImageDropzone";
import WelcomeModal from "@/components/WelcomeModal";
import { LoadingOverlay, PixelStyles } from "@/components/PixelLoader";
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
          name: blobs.length === 1 ? "compressed_batch.zip" : `compressed_batch_part${i + 1}.zip`,
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

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 xl:p-16 2xl:p-20">
      <PixelStyles />
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

      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
        <div className="p-6 md:p-8 lg:p-10 xl:p-12 text-center md:text-left">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2 tracking-tight">Batch Compressor</h1>
          <p className="text-gray-500 mb-8 text-sm md:text-base">
            {activeEngine === "local"
              ? "Drop your images below. They are compressed in your browser, so nothing is uploaded."
              : "Drop your images below. They will be compressed via ImageKit and instantly deleted from the cloud."}
          </p>

          <CompressionControls
            width={width} setWidth={setWidth}
            quality={quality} setQuality={setQuality}
            format={format} setFormat={setFormat}
            imagekitAvailable={imagekitAvailable}
            engine={activeEngine} setEngine={setEngine}
            maxKB={maxKB} setMaxKB={setMaxKB}
            keepIfLarger={keepIfLarger} setKeepIfLarger={setKeepIfLarger}
          />

          <ImageDropzone
            files={files}
            onFilesAdded={handleFilesAdded}
            onRemoveFile={handleRemoveFile}
            onClearAll={handleClearAll}
          />

          <div className="mt-8 md:mt-10 flex flex-col items-center max-w-md mx-auto">
            <button
              onClick={processImages}
              disabled={files.length === 0 || isProcessing}
              className={`w-full px-8 py-4 text-white font-medium rounded-xl text-sm md:text-base focus:ring-4 focus:outline-none transition-all cursor-pointer ${
                files.length === 0 || isProcessing
                  ? "bg-gray-300 cursor-not-allowed pointer-events-none"
                  : "bg-gray-900 hover:bg-black focus:ring-gray-300 shadow-xl shadow-gray-900/20"
              }`}
            >
              {isProcessing ? "Processing Batch..." : "Compress & Download Zip"}
            </button>

            {showResults && !isProcessing && runInfo.ok > 0 && (
              <div className="w-full mt-6 bg-green-50 border border-green-200 rounded-xl p-4 md:p-5 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                <h3 className="text-green-800 font-bold mb-1 text-sm md:text-base">Compression Complete!</h3>
                <p className="text-green-600 text-xs md:text-sm mb-3">Your zip file has been downloaded.</p>
                <div className="flex justify-center items-center space-x-4 text-sm">
                  <div className="flex flex-col items-end">
                    <span className="text-gray-500 text-xs">Original</span>
                    <span className="font-semibold text-gray-700 line-through">{formatBytes(originalSize)}</span>
                  </div>
                  <div className="text-green-500">➔</div>
                  <div className="flex flex-col items-start">
                    <span className="text-green-600 text-xs font-medium">New Size</span>
                    <span className="font-bold text-green-700">{formatBytes(compressedSize)}</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-green-200/60 inline-block px-4 text-black">
                  <span className="text-green-800 font-bold">Saved {percentSaved}%</span> of total size
                </div>
                {breakdown && <p className="mt-3 text-xs text-green-700">{breakdown}</p>}

                {downloads.length > 0 && (
                  <p className="mt-3 text-xs text-green-800 flex flex-wrap justify-center gap-x-3 gap-y-1">
                    <span>Download didn&apos;t start?</span>
                    {downloads.map((d) => (
                      <a key={d.name} href={d.url} download={d.name} className="font-semibold underline underline-offset-2">
                        {d.name}
                      </a>
                    ))}
                  </p>
                )}

                {runInfo.stopped > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Stopped early. {runInfo.stopped} image{runInfo.stopped === 1 ? "" : "s"} left in the queue.
                  </p>
                )}
                {runInfo.failed.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    {runInfo.failed.length} failed and stayed in the queue so you can retry:{" "}
                    {runInfo.failed.slice(0, 3).map((f) => f.name).join(", ")}
                    {runInfo.failed.length > 3 ? ` and ${runInfo.failed.length - 3} more` : ""}.
                    {" "}First error: {runInfo.failed[0].reason}
                  </p>
                )}
              </div>
            )}

            {showResults && !isProcessing && runInfo.ok === 0 && (
              <div className="w-full mt-6 bg-red-50 border border-red-200 rounded-xl p-4 md:p-5 text-center">
                <h3 className="text-red-800 font-bold mb-1 text-sm md:text-base">Nothing could be compressed</h3>
                <p className="text-red-600 text-xs md:text-sm">
                  {runInfo.failed.length > 0
                    ? runInfo.failed[0].reason
                    : activeEngine === "imagekit"
                    ? "ImageKit rejected every file. If your monthly quota is used up, switch the engine to Local or Auto and try again."
                    : "Nothing was processed."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
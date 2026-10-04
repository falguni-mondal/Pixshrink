"use client";

import { useEffect, useState } from "react";
import { canEncodeLocally } from "@/lib/localCompress";

const PRESETS = [
  { label: "Default", w: 1080, q: 80, f: "webp" },
  { label: "Web Optimized", w: 1200, q: 75, f: "webp" },
  { label: "High-Res Archival", w: 3840, q: 95, f: "jpg" },
  { label: "Tiny Thumbnails", w: 400, q: 60, f: "avif" },
];

const FORMATS = [
  ["webp", "WebP (Recommended)"],
  ["avif", "AVIF (Smallest)"],
  ["jpg", "JPG"],
  ["png", "PNG"],
];

const ENGINES = [
  { id: "imagekit", label: "ImageKit", hint: "Processed in the cloud by ImageKit. Uses your free monthly quota." },
  { id: "local", label: "Local", hint: "Processed in your browser. Unlimited, private, and nothing is uploaded." },
  { id: "auto", label: "Auto", hint: "Tries ImageKit first and switches to local if it fails or the quota runs out." },
];

export default function CompressionControls({
  width, setWidth,
  quality, setQuality,
  format, setFormat,
  imagekitAvailable,
  engine, setEngine,
  maxKB, setMaxKB,
  keepIfLarger, setKeepIfLarger,
}) {
  const [localSupport, setLocalSupport] = useState({});

  // Probe which formats this browser can encode (AVIF/WebP support varies by browser).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = {};
      for (const [f] of FORMATS) result[f] = await canEncodeLocally(f);
      if (!cancelled) setLocalSupport(result);
    })();
    return () => { cancelled = true; };
  }, []);

  // If the browser can't encode the chosen format locally, fall back to WebP.
  useEffect(() => {
    if (engine === "local" && localSupport[format] === false) setFormat("webp");
  }, [engine, localSupport, format, setFormat]);

  const handleWidthBlur = () => {
    if (width < 100) setWidth(100);
    if (width > 3840) setWidth(3840);
  };

  const applyPreset = (w, q, f) => {
    setWidth(w);
    setQuality(q);
    setFormat(f);
  };

  const hasTarget = Number(maxKB) > 0;

  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <span className="text-sm font-semibold text-gray-700">Quick Presets:</span>
        <div className="flex flex-wrap gap-2 justify-center md:justify-start">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.w, p.q, p.f)}
              className="cursor-pointer px-4 py-1.5 text-xs font-medium bg-white text-gray-700 rounded-md border border-gray-300 hover:bg-gray-50 hover:text-blue-600 transition-colors shadow-sm"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Engine selector: only exists when the server confirmed ImageKit is configured
          and ENVIRONMENT_MODE is "development". Otherwise the app is Local-only. */}
      {imagekitAvailable && (
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-sm font-semibold text-gray-700">Engine:</span>
            <div className="flex flex-wrap gap-2 justify-center md:justify-start">
              {ENGINES.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEngine(e.id)}
                  aria-pressed={engine === e.id}
                  className={`cursor-pointer px-4 py-1.5 text-xs font-medium rounded-md border shadow-sm transition-colors ${
                    engine === e.id
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:text-blue-600"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500 text-center md:text-left">
            {ENGINES.find((e) => e.id === engine)?.hint}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-6 bg-gray-50 p-6 md:p-8 rounded-xl border border-gray-100">
        <div className="flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3 h-8">
            <label className="text-sm font-medium text-gray-700">Target Width</label>
            <div className="flex items-center space-x-1">
              <input
                type="number"
                min="100"
                max="3840"
                value={width}
                onChange={(e) => setWidth(e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={handleWidthBlur}
                className="w-16 px-2 text-right text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-blue-600 font-semibold bg-white h-8"
              />
              <span className="text-gray-500 text-xs font-semibold">px</span>
            </div>
          </div>
          <div className="h-10 flex items-center">
            <input
              type="range"
              min="100"
              max="3840"
              value={width || 100}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3 h-8">
            <label className="text-sm font-medium text-gray-700">Quality</label>
            <span className="text-blue-600 font-semibold">{quality}</span>
          </div>
          <div className="h-10 flex items-center">
            <input
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3 h-8">
            <label className="text-sm font-medium text-gray-700 text-left">Output Format</label>
          </div>
          <div className="h-10 flex items-center">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block px-2.5 outline-none transition-shadow h-10 cursor-pointer"
            >
              {FORMATS.map(([value, label]) => {
                const blocked = engine === "local" && localSupport[value] === false;
                return (
                  <option key={value} value={value} disabled={blocked}>
                    {blocked ? `${label} (not supported by this browser)` : label}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-8 md:mb-10 px-1">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Max file size
            <input
              type="number"
              min="10"
              placeholder="off"
              value={maxKB}
              onChange={(e) => setMaxKB(e.target.value)}
              className="w-20 px-2 text-right text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-blue-600 font-semibold bg-white h-8"
            />
            <span className="text-gray-500 text-xs font-semibold">KB</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={keepIfLarger}
              onChange={(e) => setKeepIfLarger(e.target.checked)}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            Keep the original if the result is larger
          </label>
        </div>
        {hasTarget && (
          <p className="mt-2 text-xs text-gray-500 text-center md:text-left">
            {format === "png"
              ? "PNG is lossless, so a max file size has no effect on it."
              : imagekitAvailable
              ? "Max file size runs in your browser and uses the quality slider as an upper limit, regardless of the engine selected."
              : "The quality slider is the upper limit. Quality is lowered only as far as needed to fit."}
          </p>
        )}
      </div>
    </>
  );
}
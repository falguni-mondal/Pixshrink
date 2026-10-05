"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";
import { canEncodeLocally } from "@/lib/localCompress";

const PRESETS = [
  { label: "Default", w: 1080, q: 80, f: "webp" },
  { label: "Web Optimized", w: 1536, q: 80, f: "webp" },
  { label: "High-Res", w: 2400, q: 90, f: "jpg" },
  { label: "Thumbnails", w: 400, q: 60, f: "avif" },
];

const FORMATS = [
  ["webp", "WebP (Recommended)"],
  ["avif", "AVIF (Smallest)"],
  ["jpg", "JPG"],
  ["png", "PNG"],
];

// Order we try when the chosen format can't be encoded. JPG/PNG are always supported.
const FALLBACK_ORDER = ["webp", "jpg", "png"];

const ENGINES = [
  { id: "local", label: "Local", hint: "Processed in your browser. Unlimited, private, and nothing is uploaded." },
  { id: "imagekit", label: "ImageKit", hint: "Processed in the cloud by ImageKit. Uses your free monthly quota." },
  { id: "auto", label: "Auto", hint: "Tries ImageKit first and switches to local if it fails or the quota runs out." },
];

const WIDTH_MIN = 100;
const WIDTH_MAX = 3840;
const MAXKB_MIN = 10;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const labelCls = "text-xs font-black uppercase tracking-widest text-neutral-900";

// Brutalist sliders with thick borders and blocky thumbs
const CSS = `
.cc-range {-webkit-appearance:none; appearance:none; width:100%; height:32px; background:transparent; cursor:pointer; outline:none; margin:0}
.cc-range::-webkit-slider-runnable-track {height:12px; background:linear-gradient(to right, #111 var(--p,0%), #e5e5e5 var(--p,0%)); border:3px solid #111;}
.cc-range::-webkit-slider-thumb {-webkit-appearance:none; appearance:none; height:24px; width:14px; margin-top:-9px; background:#fff; border:3px solid #111; transition:background 0.15s ease;}
.cc-range:hover::-webkit-slider-thumb {background: var(--accent);}
.cc-range:active::-webkit-slider-thumb {background: #111;}
.cc-range:focus-visible::-webkit-slider-thumb {background: var(--accent); box-shadow: 0 0 0 2px #fff, 0 0 0 5px #111;}

.cc-range::-moz-range-track {height:12px; background:linear-gradient(to right, #111 var(--p,0%), #e5e5e5 var(--p,0%)); border:3px solid #111;}
.cc-range::-moz-range-thumb {height:24px; width:14px; background:#fff; border:3px solid #111; border-radius:0; transition:background 0.15s ease;}
.cc-range:hover::-moz-range-thumb {background: var(--accent);}
.cc-range:active::-moz-range-thumb {background: #111;}
.cc-range:focus-visible::-moz-range-thumb {background: var(--accent); box-shadow: 0 0 0 2px #fff, 0 0 0 5px #111;}

.cc-range:disabled {cursor:not-allowed; opacity:.35}
.cc-range:disabled:hover::-webkit-slider-thumb {background:#fff}
.cc-range:disabled:hover::-moz-range-thumb {background:#fff}

.cc-num {-moz-appearance:textfield; appearance:textfield}
.cc-num::-webkit-outer-spin-button, .cc-num::-webkit-inner-spin-button {-webkit-appearance:none; margin:0}
`;

// A rigid, hard-bordered grid instead of a sliding pill
function Segmented({ options, value, onChange, label, fullWidth = false }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex rounded-none border-[3px] border-neutral-900 bg-white shadow-[3px_3px_0_rgba(17,17,17,1)] overflow-hidden ${
        fullWidth ? "w-full" : "w-fit"
      }`}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={o.disabled}
            title={o.title}
            aria-pressed={active}
            className={`relative px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors focus:outline-none focus-visible:bg-neutral-200 ${
              fullWidth ? "flex-1" : ""
            } ${
              i !== 0 ? "border-l-[3px] border-neutral-900" : ""
            } ${
              o.disabled
                ? "cursor-not-allowed bg-neutral-100 text-neutral-300 line-through"
                : active
                ? "cursor-pointer bg-[var(--accent)] text-neutral-900"
                : "cursor-pointer bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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
  const uid = useId();
  const hintRef = useRef(null);

  const hasTarget = Number(maxKB) > 0;
  // The local engine is used when it's selected, and also whenever a Max Limit is set
  // (the cloud engine can't target a file size), so format support matters in both cases.
  const needsLocal = engine === "local" || hasTarget;
  const isPng = format === "png";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = {};
      for (const [f] of FORMATS) result[f] = await canEncodeLocally(f);
      if (!cancelled) setLocalSupport(result);
    })();
    return () => { cancelled = true; };
  }, []);

  // Returns `f` if usable, otherwise the first supported alternative (never `f` itself).
  const resolveFormat = useCallback(
    (f) => {
      if (!needsLocal || localSupport[f] !== false) return f;
      return FALLBACK_ORDER.find((c) => c !== f && localSupport[c] !== false) || "jpg";
    },
    [needsLocal, localSupport]
  );

  useEffect(() => {
    const next = resolveFormat(format);
    if (next !== format) setFormat(next);
  }, [format, resolveFormat, setFormat]);

  const clampWidth = () => {
    const n = Number(width);
    if (!Number.isFinite(n) || n < WIDTH_MIN) setWidth(WIDTH_MIN);
    else if (n > WIDTH_MAX) setWidth(WIDTH_MAX);
  };

  const clampMaxKB = () => {
    if (maxKB === "") return;
    const n = Number(maxKB);
    if (!Number.isFinite(n) || n <= 0) setMaxKB("");
    else if (n < MAXKB_MIN) setMaxKB(String(MAXKB_MIN));
  };

  const applyPreset = (w, q, f) => {
    setWidth(w);
    setQuality(q);
    setFormat(resolveFormat(f));
  };

  const widthPct = Math.min(100, Math.max(0, (((Number(width) || WIDTH_MIN) - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100));
  const qualityPct = Math.min(100, Math.max(0, ((Number(quality) - 1) / 99) * 100));

  const formatOptions = FORMATS.map(([value, label]) => {
    const blocked = needsLocal && localSupport[value] === false;
    return {
      value,
      label: label.replace(/\s*\(.*\)$/, ""),
      disabled: blocked,
      title: blocked ? `${label} (not supported by this browser)` : undefined,
    };
  });

  const formatNote = FORMATS.find(([v]) => v === format)?.[1].match(/\((.*)\)/)?.[1];
  const engineOptions = ENGINES.map((e) => ({ value: e.id, label: e.label }));

  useEffect(() => {
    const el = hintRef.current;
    if (!hasTarget || !el || prefersReducedMotion()) return;
    const tween = gsap.fromTo(
      el,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
    );
    return () => {
      tween.kill();
      gsap.set(el, { clearProps: "opacity,transform" });
    };
  }, [hasTarget]);

  return (
    <div className="mb-8 text-left md:mb-10">
      <style>{CSS}</style>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className={`${labelCls} sm:w-32 sm:shrink-0`}>Quick Presets</span>
        <div className="flex flex-wrap gap-2.5">
          {PRESETS.map((p) => {
            // Compare against the format this preset would actually apply on this browser.
            const active = width === p.w && quality === p.q && format === resolveFormat(p.f);
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p.w, p.q, p.f)}
                aria-pressed={active}
                className={`cursor-pointer border-[3px] border-neutral-900 px-4 py-2 text-xs font-black uppercase tracking-wider transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 ${
                  active
                    ? "bg-neutral-900 text-[var(--accent)] shadow-[3px_3px_0_var(--accent)]"
                    : "bg-white text-neutral-900 shadow-[3px_3px_0_rgba(17,17,17,1)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[5px_5px_0_var(--accent)] active:translate-y-0 active:translate-x-0 active:shadow-[0_0_0_rgba(17,17,17,1)]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {imagekitAvailable && (
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className={`${labelCls} sm:w-32 sm:shrink-0`}>Engine</span>
            <Segmented options={engineOptions} value={engine} onChange={setEngine} label="Compression engine" />
          </div>
          <p className="mt-3 font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-500 sm:pl-32">
            {ENGINES.find((e) => e.id === engine)?.hint}
          </p>
        </div>
      )}

      {/* Main Settings Bento Box */}
      <div className="mb-6 grid grid-cols-1 gap-7 rounded-none border-[3px] border-neutral-900 bg-white p-6 shadow-[6px_6px_0_rgba(17,17,17,1)] md:grid-cols-3 md:gap-8 md:p-8">

        <div className="flex flex-col justify-between">
          <div className="mb-4 flex h-8 items-center justify-between">
            <label htmlFor={`${uid}-width`} className={labelCls}>Width</label>
            <div className="flex items-center gap-1.5">
              <input
                id={`${uid}-width`}
                type="number"
                min={WIDTH_MIN}
                max={WIDTH_MAX}
                value={width}
                onChange={(e) => setWidth(e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={clampWidth}
                className="cc-num h-8 w-[4.5rem] rounded-none border-[2px] border-neutral-900 bg-neutral-100 px-2 text-right font-mono text-sm font-bold text-neutral-900 outline-none transition-colors focus:border-[var(--accent)] focus:bg-white"
              />
              <span className="font-mono text-xs font-bold text-neutral-400">PX</span>
            </div>
          </div>
          <div className="flex h-10 items-center">
            <input
              type="range"
              aria-label="Target width"
              min={WIDTH_MIN}
              max={WIDTH_MAX}
              value={width || WIDTH_MIN}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{ "--p": `${widthPct}%` }}
              className="cc-range"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="mb-4 flex h-8 items-center justify-between">
            <label htmlFor={`${uid}-quality`} className={labelCls}>Quality</label>
            <span className={`font-mono text-xl font-black ${isPng ? "text-neutral-300" : "text-neutral-900"}`}>
              {isPng ? "LOSSLESS" : quality}
            </span>
          </div>
          <div className="flex h-10 items-center">
            <input
              id={`${uid}-quality`}
              type="range"
              min="1"
              max="100"
              value={quality}
              disabled={isPng}
              onChange={(e) => setQuality(Number(e.target.value))}
              style={{ "--p": `${qualityPct}%` }}
              className="cc-range"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="mb-4 flex h-8 items-center justify-between">
            <span className={labelCls}>Format</span>
            {formatNote && (
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--accent)] drop-shadow-[0.5px_0.5px_0_rgba(17,17,17,1)]">{formatNote}</span>
            )}
          </div>
          <div className="flex h-10 items-center">
            <Segmented options={formatOptions} value={format} onChange={setFormat} label="Output format" fullWidth />
          </div>
        </div>
      </div>

      {/* Advanced Settings Row */}
      <div className="px-1">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
          <label className="flex items-center gap-3 text-xs font-black uppercase tracking-wider text-neutral-900">
            Max Limit
            <span className="flex h-10 items-center rounded-none border-[3px] border-neutral-900 bg-white pr-3 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-colors focus-within:border-[var(--accent)]">
              <input
                type="number"
                min={MAXKB_MIN}
                placeholder="OFF"
                value={maxKB}
                onChange={(e) => setMaxKB(e.target.value)}
                onBlur={clampMaxKB}
                className="cc-num h-full w-16 bg-transparent px-3 text-right font-mono text-sm font-bold text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400"
              />
              <span className="font-mono text-xs font-bold text-neutral-400">KB</span>
            </span>
          </label>

          <label className="flex cursor-pointer select-none items-center gap-3 text-xs font-black uppercase tracking-wider text-neutral-900">
            <div className="relative flex items-center">
              <input
                type="checkbox"
                checked={keepIfLarger}
                onChange={(e) => setKeepIfLarger(e.target.checked)}
                className="peer sr-only"
              />
              {/* Hard brutalist square toggle box */}
              <div className="h-6 w-6 rounded-none border-[3px] border-neutral-900 bg-white transition-colors duration-200 peer-checked:bg-[var(--accent)] peer-focus-visible:ring-4 peer-focus-visible:ring-neutral-900/30" />
              <svg
                className={`absolute inset-0 h-6 w-6 pointer-events-none stroke-neutral-900 stroke-[3px] transition-transform duration-200 ${keepIfLarger ? "scale-100" : "scale-0"}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeLinecap="square"
                strokeLinejoin="miter"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            Keep original if result is larger
          </label>
        </div>

        {hasTarget && (
          <p ref={hintRef} className="mt-4 font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            {isPng
              ? "PNG is lossless, so a max file size has no effect on it."
              : imagekitAvailable
              ? "Max file size runs locally and uses the quality slider as an upper limit."
              : "The quality slider is the upper limit. Quality is lowered to fit."}
          </p>
        )}
      </div>
    </div>
  );
}
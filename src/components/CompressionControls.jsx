"use client";

import { useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";
import { canEncodeLocally } from "@/lib/localCompress";

const PRESETS = [
  { label: "Default", w: 1080, q: 80, f: "webp" },
  { label: "Web Optimized", w: 1536, q: 80, f: "webp" },
  { label: "High-Res Archival", w: 2400, q: 90, f: "jpg" },
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

// ---------------------------------------------------------------------------------------
// Design helpers (UI only, no effect on the compression settings logic)
// ---------------------------------------------------------------------------------------
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const labelCls = "text-[13px] font-medium text-neutral-600";

// Range sliders and number inputs need pseudo-element styling, so they live in a small scoped sheet.
const CSS = `
.cc-range{-webkit-appearance:none;appearance:none;width:100%;height:20px;background:transparent;cursor:pointer;outline:none;margin:0}
.cc-range::-webkit-slider-runnable-track{height:6px;border-radius:9999px;background:linear-gradient(to right,#171717 var(--p,0%),#e5e5e5 var(--p,0%))}
.cc-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;height:20px;width:20px;margin-top:-7px;border-radius:9999px;background:#fff;border:1px solid #d4d4d4;box-shadow:0 2px 6px rgba(0,0,0,.18);transition:transform .2s ease,box-shadow .2s ease}
.cc-range:hover::-webkit-slider-thumb{transform:scale(1.08)}
.cc-range:active::-webkit-slider-thumb{transform:scale(1.16)}
.cc-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 4px rgba(23,23,23,.15),0 2px 6px rgba(0,0,0,.18)}
.cc-range::-moz-range-track{height:6px;border-radius:9999px;background:linear-gradient(to right,#171717 var(--p,0%),#e5e5e5 var(--p,0%))}
.cc-range::-moz-range-thumb{height:18px;width:18px;border-radius:9999px;background:#fff;border:1px solid #d4d4d4;box-shadow:0 2px 6px rgba(0,0,0,.18);transition:transform .2s ease,box-shadow .2s ease}
.cc-range:hover::-moz-range-thumb{transform:scale(1.08)}
.cc-range:active::-moz-range-thumb{transform:scale(1.16)}
.cc-range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 4px rgba(23,23,23,.15),0 2px 6px rgba(0,0,0,.18)}
.cc-num{-moz-appearance:textfield;appearance:textfield}
.cc-num::-webkit-outer-spin-button,.cc-num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
`;

// Segmented control with a white "pill" that glides to the selected option (GSAP).
function Segmented({ options, value, onChange, label, fullWidth = false }) {
  const wrapRef = useRef(null);
  const indicatorRef = useRef(null);
  const btnRefs = useRef({});
  const placedRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const indicator = indicatorRef.current;
    const btn = btnRefs.current[value];
    if (!wrap || !indicator || !btn) return;

    const target = () => ({ x: btn.offsetLeft, width: btn.offsetWidth, opacity: 1 });

    if (placedRef.current && !prefersReducedMotion()) {
      gsap.to(indicator, { ...target(), duration: 0.45, ease: "power3.out", overwrite: "auto" });
    } else {
      gsap.set(indicator, target()); // first paint (and reduced motion): no travel
    }
    placedRef.current = true;

    // Keep the pill aligned if the control is resized (window resize, font load, wrapping)
    const ro = new ResizeObserver(() => {
      if (!gsap.isTweening(indicator)) gsap.set(indicator, target());
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [value]);

  return (
    <div
      ref={wrapRef}
      role="group"
      aria-label={label}
      className={`relative flex rounded-xl bg-neutral-100 p-1 ring-1 ring-inset ring-neutral-200/70 ${
        fullWidth ? "w-full" : "w-fit"
      }`}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-0 top-1 w-0 rounded-lg bg-white opacity-0 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)]"
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            ref={(el) => {
              btnRefs.current[o.value] = el;
            }}
            onClick={() => onChange(o.value)}
            disabled={o.disabled}
            title={o.title}
            aria-pressed={active}
            className={`relative z-10 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
              fullWidth ? "flex-1" : ""
            } ${
              o.disabled
                ? "cursor-not-allowed text-neutral-300 line-through"
                : active
                ? "cursor-pointer text-neutral-900"
                : "cursor-pointer text-neutral-500 hover:text-neutral-800"
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

  // -------------------------------------------------------------------------------------
  // Design + GSAP (everything below only affects how the controls look and move)
  // -------------------------------------------------------------------------------------
  const uid = useId();
  const hintRef = useRef(null);

  const widthPct = Math.min(100, Math.max(0, (((Number(width) || 100) - 100) / (3840 - 100)) * 100));
  const qualityPct = Math.min(100, Math.max(0, ((Number(quality) - 1) / 99) * 100));

  const formatOptions = FORMATS.map(([value, label]) => {
    const blocked = engine === "local" && localSupport[value] === false;
    return {
      value,
      label: label.replace(/\s*\(.*\)$/, ""),
      disabled: blocked,
      title: blocked ? `${label} (not supported by this browser)` : undefined,
    };
  });
  const formatNote = FORMATS.find(([v]) => v === format)?.[1].match(/\((.*)\)/)?.[1];
  const engineOptions = ENGINES.map((e) => ({ value: e.id, label: e.label }));

  // The "max file size" note eases in when a target is set
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

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className={`${labelCls} sm:w-28 sm:shrink-0`}>Quick Presets</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = width === p.w && quality === p.q && format === p.f;
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p.w, p.q, p.f)}
                aria-pressed={active}
                className={`cursor-pointer rounded-full border px-4 py-1.5 text-xs font-medium transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 active:scale-[0.97] ${
                  active
                    ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Engine selector: only exists when the server confirmed ImageKit is configured
          and ENVIRONMENT_MODE is "development". Otherwise the app is Local-only. */}
      {imagekitAvailable && (
        <div className="mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className={`${labelCls} sm:w-28 sm:shrink-0`}>Engine</span>
            <Segmented options={engineOptions} value={engine} onChange={setEngine} label="Compression engine" />
          </div>
          <p className="mt-2 text-xs text-neutral-500 sm:pl-28">
            {ENGINES.find((e) => e.id === engine)?.hint}
          </p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-7 rounded-2xl border border-neutral-200/80 bg-neutral-50/60 p-5 md:grid-cols-3 md:gap-8 md:p-7">
        <div className="flex flex-col justify-between">
          <div className="mb-3 flex h-8 items-center justify-between">
            <label htmlFor={`${uid}-width`} className={labelCls}>Target Width</label>
            <div className="flex items-center gap-1.5">
              <input
                id={`${uid}-width`}
                type="number"
                min="100"
                max="3840"
                value={width}
                onChange={(e) => setWidth(e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={handleWidthBlur}
                className="cc-num h-8 w-[4.5rem] rounded-md border border-neutral-200 bg-white px-2 text-right font-mono text-sm font-semibold text-neutral-900 outline-none transition-colors focus:border-neutral-900"
              />
              <span className="font-mono text-xs text-neutral-400">px</span>
            </div>
          </div>
          <div className="flex h-10 items-center">
            <input
              type="range"
              aria-label="Target width"
              min="100"
              max="3840"
              value={width || 100}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{ "--p": `${widthPct}%` }}
              className="cc-range"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="mb-3 flex h-8 items-center justify-between">
            <label htmlFor={`${uid}-quality`} className={labelCls}>Quality</label>
            <span className="font-mono text-sm font-semibold text-neutral-900">{quality}</span>
          </div>
          <div className="flex h-10 items-center">
            <input
              id={`${uid}-quality`}
              type="range"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              style={{ "--p": `${qualityPct}%` }}
              className="cc-range"
            />
          </div>
        </div>

        <div className="flex flex-col justify-between">
          <div className="mb-3 flex h-8 items-center justify-between">
            <span className={labelCls}>Output Format</span>
            {formatNote && (
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-400">{formatNote}</span>
            )}
          </div>
          <div className="flex h-10 items-center">
            <Segmented options={formatOptions} value={format} onChange={setFormat} label="Output format" fullWidth />
          </div>
        </div>
      </div>

      <div className="px-1">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <label className="flex items-center gap-3 text-sm font-medium text-neutral-700">
            Max file size
            <span className="flex h-9 items-center rounded-lg border border-neutral-200 bg-white pr-2.5 transition-colors focus-within:border-neutral-900">
              <input
                type="number"
                min="10"
                placeholder="off"
                value={maxKB}
                onChange={(e) => setMaxKB(e.target.value)}
                className="cc-num h-full w-16 bg-transparent px-2 text-right font-mono text-sm font-semibold text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400"
              />
              <span className="font-mono text-xs text-neutral-400">KB</span>
            </span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-3 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={keepIfLarger}
              onChange={(e) => setKeepIfLarger(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="relative h-5 w-9 shrink-0 rounded-full bg-neutral-300 transition-colors duration-300 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-300 after:content-[''] peer-checked:bg-neutral-900 peer-checked:after:translate-x-4 peer-focus-visible:ring-4 peer-focus-visible:ring-neutral-300"
            />
            Keep the original if the result is larger
          </label>
        </div>
        {hasTarget && (
          <p ref={hintRef} className="mt-3 text-xs text-neutral-500">
            {format === "png"
              ? "PNG is lossless, so a max file size has no effect on it."
              : imagekitAvailable
              ? "Max file size runs in your browser and uses the quality slider as an upper limit, regardless of the engine selected."
              : "The quality slider is the upper limit. Quality is lowered only as far as needed to fit."}
          </p>
        )}
      </div>
    </div>
  );
}
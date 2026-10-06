"use client";

// Phone-only warnings for heavy jobs (HEIC on Android, AVIF on any phone).
//  - <FormatWarning>: the banner. Levels come from getMobileAdvice() in lib/device.js.
//  - <ConfirmCompressDialog>: shown when Compress is pressed in the strongest case. Nothing
//    is blocked: the user either continues or switches to WebP.
// Wording lives here, so lib/device.js only has to return codes.

import { useEffect, useId, useRef } from "react";
import { getLenis } from "@/components/SmoothScroll";

const AVIF_COPY = {
  title: "AVIF is slow on phones",
  reason: (n) =>
    `Each image takes much longer than WebP, so batches are limited to ${n} images.`,
  action: "Keep the screen on while it runs.",
  canSwitch: true,
};

const COPY = {
  "android-heic": {
    title: "HEIC photos use a lot of memory here",
    reason: (n) =>
      `Decoding HEIC on Android is memory-heavy and slow, so batches are limited to ${n} images.`,
    action: "Keep this tab open and the screen on while it runs.",
    canSwitch: false,
  },
  "android-avif": AVIF_COPY,
  "ios-avif": AVIF_COPY,
  "android-heic-avif": {
    title: "HEIC to AVIF is very heavy on Android",
    reason: (n) =>
      `Decoding HEIC and encoding AVIF both need a lot of memory and time, so batches are limited to ${n} images.`,
    action: "Or switch to WebP, which is much faster on this phone.",
    canSwitch: true,
  },
};

// Starting guess (T): one 12 MP HEIC to AVIF at 1080 px on a phone. NOT measured yet.
// It only feeds the "about N min" line in the confirm dialog. Once the first image is done,
// the loading screen shows a live estimate from real timings.
const BASE_SECONDS_PER_IMAGE = 40;

/** "about 14 min" for the confirm dialog. Rough on purpose. */
export function estimateText({ count, width, hasMaxKB }) {
  const w = Math.min(Math.max(Number(width) || 1080, 400), 3840);
  const perImage = BASE_SECONDS_PER_IMAGE * (w / 1080) ** 2 * (hasMaxKB ? 3 : 1);
  const minutes = Math.max(1, Math.round((count * perImage) / 60));
  return `about ${minutes} min`;
}

// The highlighted line shown in every phone warning (HEIC and AVIF are both heavy here).
const TipLine = ({ className = "" }) => (
  <p className={`flex flex-wrap items-center gap-2 ${className}`}>
    <span className="bg-neutral-900 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-[#FFE600]">
      Best results
    </span>
    <span className="text-sm font-black text-neutral-900">
      Use a computer for better results.
    </span>
  </p>
);

const WarnIcon = () => (
  <svg
    className="mt-0.5 h-6 w-6 shrink-0 text-neutral-900"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2.5"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const switchBtn =
  "cursor-pointer rounded-none border-[3px] border-neutral-900 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wider text-neutral-900 shadow-[3px_3px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[5px_5px_0_rgba(17,17,17,1)] active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30";

/**
 * @param {{ advice: { level: string, reason: string|null, fileLimit: number },
 *           onSwitch?: () => void, className?: string }} props
 *   onSwitch changes the output format to WebP. className sets the outer spacing/width.
 */
export default function FormatWarning({ advice, onSwitch, className = "mb-6" }) {
  const copy = advice ? COPY[advice.reason] : null;
  if (!copy || advice.level === "none") return null;
  const strong = advice.level === "strong";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-none border-[3px] border-neutral-900 p-5 text-left shadow-[4px_4px_0_rgba(17,17,17,1)] ${
        strong ? "bg-red-50" : "bg-[#FFE600]"
      } ${className}`}
    >
      <div className="flex items-start gap-4">
        <WarnIcon />
        <div className="min-w-0">
          <h3
            className={`text-sm font-black uppercase tracking-wide ${
              strong ? "text-red-600" : "text-neutral-900"
            }`}
          >
            {copy.title}
          </h3>
          <p className="mt-1 text-sm font-medium text-neutral-800">
            {copy.reason(advice.fileLimit)}
          </p>
          <p className="mt-1 text-sm font-medium text-neutral-800">{copy.action}</p>
          <TipLine className="mt-3" />
          {copy.canSwitch && onSwitch && (
            <button type="button" onClick={onSwitch} className={`mt-4 ${switchBtn}`}>
              Switch to WebP
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const DIALOG_CSS = `
@keyframes fw-fade{from{opacity:0}to{opacity:1}}
@keyframes fw-pop{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
.fw-fade{animation:fw-fade .2s ease backwards}
.fw-pop{animation:fw-pop .3s cubic-bezier(.22,1,.36,1) backwards}
@media (prefers-reduced-motion:reduce){.fw-fade,.fw-pop{animation:none}}
`;

/**
 * Confirm step for the strongest warning. Escape or a tap outside closes it (nothing starts).
 *
 * @param {{ open: boolean, fileCount: number, estimate: string,
 *           onContinue: () => void, onSwitch: () => void, onClose: () => void }} props
 */
export function ConfirmCompressDialog({ open, fileCount, estimate, onContinue, onSwitch, onClose }) {
  const dialogRef = useRef(null);
  const switchRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // the effect below must not restart when the parent re-renders
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const lenis = getLenis();
    lenis?.stop(); // freeze the page scroll behind the dialog
    switchRef.current?.focus(); // the safe choice is focused first

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const buttons = dialogRef.current?.querySelectorAll("button");
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      lenis?.start();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <style>{DIALOG_CSS}</style>
      <div
        aria-hidden="true"
        onClick={() => closeRef.current()}
        className="fw-fade absolute inset-0 bg-neutral-900/60"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="fw-pop relative w-full max-w-md rounded-none border-[3px] border-neutral-900 bg-white p-6 text-left shadow-[6px_6px_0_rgba(17,17,17,1)]"
      >
        <h2
          id={titleId}
          className="text-lg font-black uppercase tracking-tight text-neutral-900"
        >
          This will take a while
        </h2>
        <p id={descId} className="mt-3 text-sm font-medium leading-relaxed text-neutral-700">
          Converting {fileCount} image{fileCount === 1 ? "" : "s"} to AVIF on this phone,
          including HEIC photos, will take{" "}
          <span className="font-black text-neutral-900">{estimate}</span>, and it may use a lot
          of memory. That is a rough guess; once the first image is done, the loading screen
          shows a live estimate. Keep the screen on and this tab open.
        </p>
        <TipLine className="mt-4" />

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button
            ref={switchRef}
            type="button"
            onClick={onSwitch}
            className="flex-1 cursor-pointer rounded-none border-[3px] border-neutral-900 bg-[var(--accent)] px-4 py-3 text-xs font-black uppercase tracking-wider text-neutral-900 shadow-[3px_3px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[5px_5px_0_rgba(17,17,17,1)] active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30"
          >
            Switch to WebP
          </button>
          <button type="button" onClick={onContinue} className={`flex-1 py-3 ${switchBtn}`}>
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
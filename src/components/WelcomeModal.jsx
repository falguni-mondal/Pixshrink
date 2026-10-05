"use client";

import { useEffect, useRef, useState } from "react";
import { PixelMosaic } from "@/components/PixelLoader";

const SEEN_KEY = "batch-compressor-welcome-seen";

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {}
    if (!seen) setOpen(true);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
  };

  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="px-fade fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/40 p-5 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-desc"
        onClick={(e) => e.stopPropagation()}
        className="px-rise w-full max-w-sm rounded-none border-[3px] border-neutral-900 bg-white p-8 text-center shadow-[8px_8px_0_rgba(17,17,17,1)]"
      >
        <PixelMosaic size={72} className="mx-auto" />

        <h2 id="welcome-title" className="mt-8 text-xl font-black uppercase tracking-widest text-neutral-900">
          Local Processing
        </h2>
        
        <p id="welcome-desc" className="mt-4 text-sm font-medium leading-relaxed text-neutral-600">
          Your images are compressed right here in your browser and are never uploaded. 
          The only limit is your device's memory.
        </p>
        
        <p className="mt-5 border-t-[3px] border-neutral-900 pt-4 font-mono text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          Working with a massive batch? Process it in smaller groups.
        </p>

        <button
          ref={buttonRef}
          onClick={close}
          className="mt-8 w-full cursor-pointer rounded-none border-[3px] border-neutral-900 bg-[var(--accent)] py-3 text-sm font-black uppercase tracking-widest text-neutral-900 shadow-[4px_4px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[6px_6px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus:outline-none  focus-visible:ring-neutral-900/30"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
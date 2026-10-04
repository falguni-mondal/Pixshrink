"use client";

import { useEffect, useRef, useState } from "react";
import { PixelMosaic } from "@/components/PixelLoader";

// Shown once per browser session. To show it on every page load instead,
// delete the sessionStorage lines below.
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

  // Focus the button, close on Escape, and lock page scroll while the popup is open.
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
      className="px-fade fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/30 p-5 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-desc"
        onClick={(e) => e.stopPropagation()}
        className="px-rise w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl shadow-gray-900/10 ring-1 ring-gray-900/5"
      >
        <PixelMosaic size={72} className="mx-auto" />

        <h2 id="welcome-title" className="mt-6 text-xl font-semibold tracking-tight text-gray-900">
          Everything runs on your device
        </h2>
        <p id="welcome-desc" className="mt-3 text-sm leading-relaxed text-gray-500">
          Your images are compressed right here in your browser and are never uploaded. That also
          means your device sets the limits: how many images you can process, and how large they
          can be, depends on its memory and speed.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-gray-500">
          Working with a big batch? Process it in smaller groups.
        </p>

        <button
          ref={buttonRef}
          onClick={close}
          className="mt-8 w-full cursor-pointer rounded-xl bg-gray-900 py-3 text-sm font-medium text-white transition-colors hover:bg-black focus:outline-none focus-visible:ring-4 focus-visible:ring-gray-300"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
"use client";

import { memo, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { makeThumbnail } from "@/lib/thumbnail";
import { isHeicFile } from "@/lib/fileTypes";
import { prefersReducedMotion } from "@/lib/device";
import { PixelMosaic } from "@/components/PixelLoader";

// Tiles animate in with a pure CSS animation (`backwards` fill), so a tile is always
// visible as its normal state. If JS is busy or an animation is interrupted, nothing
// can get stuck at opacity 0.
const DZ_CSS = `
.dz-scroll{scrollbar-width:thin;scrollbar-color:#111 transparent;overscroll-behavior:contain}
.dz-scroll::-webkit-scrollbar{width:12px; border-left: 3px solid #111;}
.dz-scroll::-webkit-scrollbar-track{background:transparent}
.dz-scroll::-webkit-scrollbar-thumb{background:#111; border: 2px solid #fff;}
.dz-scroll::-webkit-scrollbar-thumb:hover{background:var(--accent);}
@keyframes dz-in{from{opacity:0;transform:translateY(12px) scale(.94)}to{opacity:1;transform:none}}
.dz-in{animation:dz-in .45s cubic-bezier(.22,1,.36,1) backwards;animation-delay:var(--d,0ms)}
@media (prefers-reduced-motion:reduce){.dz-in{animation:none}}
`;

const SUPPORTED = ["JPG", "PNG", "WEBP", "AVIF", "HEIC"];
const TOAST_MS = 6000;

// Explicit allow-list. Anything else (SVG, animated GIF, PDFs, folders...) is rejected
// with a message instead of failing later or vanishing silently.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const ALLOWED_EXT = /\.(jpe?g|png|webp|avif|heic|heif)$/i;

const isSupportedFile = (file) =>
  isHeicFile(file) ||
  ALLOWED_TYPES.has(file.type) ||
  // Some browsers report an empty MIME type, so fall back to the extension.
  (!file.type && ALLOWED_EXT.test(file.name));

function splitFiles(list) {
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(list)) {
    (isSupportedFile(file) ? accepted : rejected).push(file);
  }
  return { accepted, rejected };
}

function rejectionMessage(rejected) {
  const names = rejected.slice(0, 2).map((f) => f.name || "unnamed");
  const more = rejected.length > 2 ? ` and ${rejected.length - 2} more` : "";
  const noun = rejected.length === 1 ? "file" : "files";
  return `${rejected.length} ${noun} skipped (${names.join(", ")}${more}). Only JPG, PNG, WEBP, AVIF and HEIC are supported.`;
}

const ImagePreview = memo(function ImagePreview({ fileObj, onRemove, index = 0 }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const holderRef = useRef(null);
  const removingRef = useRef(false);

  // Builds the thumbnail only once the tile scrolls into view, and cleans up everything
  // (pending work, observer, object URL, tweens) in one place.
  // Keyed on the id, not the file: the parent may swap `file` for an in-memory copy later
  // (phones, HEIC), and that must not restart the thumbnail.
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;

    const controller = new AbortController();
    let objectUrl = "";
    let started = false;
    let observer = null;

    const start = () => {
      if (started) return;
      started = true;
      makeThumbnail(fileObj.file, { signal: controller.signal })
        .then((u) => {
          if (controller.signal.aborted) {
            URL.revokeObjectURL(u);
          } else {
            objectUrl = u;
            setUrl(u);
          }
        })
        .catch((error) => {
          if (error?.name !== "AbortError" && !controller.signal.aborted) setFailed(true);
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      start();
    } else {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          start();
          observer.disconnect();
        }
      });
      observer.observe(el);
    }

    return () => {
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      gsap.killTweensOf(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileObj.id]);

  const handleRemove = (e) => {
    e.stopPropagation();
    const el = holderRef.current;
    if (!el || removingRef.current || prefersReducedMotion()) {
      onRemove(fileObj.id);
      return;
    }
    removingRef.current = true;
    gsap.to(el, {
      opacity: 0,
      scale: 0.85,
      duration: 0.2,
      ease: "power2.in",
      overwrite: "auto",
      onComplete: () => onRemove(fileObj.id),
    });
  };

  return (
    <div
      ref={holderRef}
      data-tile
      style={{ "--d": `${Math.min(index, 24) * 30}ms` }}
      className="dz-in group/tile relative aspect-square rounded-none border-[3px] border-neutral-900 bg-white transform-gpu shadow-[4px_4px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 hover:shadow-[6px_6px_0_rgba(17,17,17,1)]"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={fileObj.file.name || "Preview"}
          width={160}
          height={160}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : failed ? (
        <div className="flex h-full w-full items-center justify-center bg-red-50 p-2 text-center">
          <span className="line-clamp-3 break-all font-mono text-[10px] font-bold uppercase text-red-600">
            {fileObj.file.name}
          </span>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-neutral-100">
          <PixelMosaic size={28} grid={4} />
        </div>
      )}

      {url && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-neutral-900 px-2 py-1.5 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 border-t-[3px] border-neutral-900">
          <p className="truncate font-mono text-[9px] font-bold uppercase tracking-wider text-white">{fileObj.file.name}</p>
        </div>
      )}

      <button
        onClick={handleRemove}
        className="absolute -right-3 -top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-none border-[3px] border-neutral-900 bg-white text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-all duration-200 hover:bg-[var(--accent)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100"
        title="Remove image"
        aria-label={`Remove ${fileObj.file.name}`}
      >
        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});

function ImageDropzone({ files, adding, onFilesAdded, onRemoveFile, onClearAll }) {
  const fileInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const [toast, setToast] = useState({ title: "", message: "" });

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const showToast = (title, message) => {
    clearTimeout(toastTimerRef.current);
    setToast({ title, message });
    toastTimerRef.current = setTimeout(() => setToast({ title: "", message: "" }), TOAST_MS);
  };

  // The parent enforces the mobile cap and skips duplicates. This only filters by type.
  const handleFiles = (list) => {
    const { accepted, rejected } = splitFiles(list);
    if (rejected.length) showToast("Files Skipped", rejectionMessage(rejected));
    if (accepted.length) onFilesAdded(accepted);
  };

  const openPicker = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // lets the same file be picked again later
    if (picked.length) handleFiles(picked);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer?.files;
    if (dropped?.length) handleFiles(dropped);
  };

  const handleDragOver = (e) => e.preventDefault();

  const isEmpty = files.length === 0;
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const iconRef = useRef(null);

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const handleDragEnter = (e) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const endDrag = () => {
    dragDepth.current = 0;
    setIsDragging(false);
  };

  useEffect(() => {
    if (!isDragging || !isEmpty || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      if (iconRef.current) {
        gsap.to(iconRef.current, { y: -8, duration: 0.4, ease: "steps(4)", yoyo: true, repeat: -1 });
      }
    });
    return () => ctx.revert();
  }, [isDragging, isEmpty]);

  const emptyKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  const toastVisible = Boolean(toast.message);

  return (
    <div
      onDrop={(e) => {
        endDrag();
        handleDrop(e);
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className={`group/dz relative flex w-full flex-col overflow-hidden rounded-none border-[3px] border-neutral-900 shadow-[6px_6px_0_rgba(17,17,17,1)] transition-colors duration-200 ${
        files.length > 0
          ? `h-[340px] bg-white`
          : `h-[280px] cursor-pointer items-center justify-center md:h-[340px] ${
              isDragging ? "bg-[var(--accent)]" : "bg-white hover:bg-neutral-50"
            }`
      }`}
      onClick={(e) => {
        // Ignore the click the hidden input bubbles up when we open the picker.
        if (e.target === fileInputRef.current) return;
        if (files.length === 0) openPicker();
      }}
      {...(isEmpty
        ? { role: "button", tabIndex: 0, "aria-label": "Select images to compress", onKeyDown: emptyKeyDown }
        : {})}
    >
      <style>{DZ_CSS}</style>

      {/* Brutalist toast, used for skipped (unsupported) files */}
      <div
        role="status"
        aria-live="polite"
        aria-hidden={!toastVisible}
        className={`absolute left-4 right-4 top-4 z-50 flex items-start gap-4 rounded-none border-[3px] border-neutral-900 bg-[#FFE600] p-4 shadow-[4px_4px_0_rgba(17,17,17,1)] transition-all duration-300 ${
          toastVisible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0 pointer-events-none"
        }`}
      >
        <svg className="mt-0.5 h-6 w-6 shrink-0 text-neutral-900" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="min-w-0">
          <h3 className="text-xs font-black uppercase tracking-wide text-neutral-900">{toast.title}</h3>
          <p className="mt-1 break-words text-xs font-medium text-neutral-800">{toast.message}</p>
        </div>
      </div>

      {/* Progress strip: shown only while real background work runs (phone HEIC copies).
          It never blocks the tiles or buttons, so it can't trap the user. */}
      {adding && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex items-center gap-4 border-t-[3px] border-neutral-900 bg-[#FFE600] px-5 py-3"
        >
          <PixelMosaic size={22} grid={4} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-neutral-900">
              Preparing images{" "}
              <span className="font-mono">
                {Math.min(adding.done, adding.total)} / {adding.total}
              </span>
            </p>
            <div className="mt-2 h-2.5 w-full overflow-hidden border-[2px] border-neutral-900 bg-white">
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-150"
                style={{ width: `${adding.total ? (adding.done / adding.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {files.length > 0 ? (
        <div className="flex h-full w-full cursor-default flex-col">
          <div className="z-20 flex shrink-0 items-center justify-between border-b-[3px] border-neutral-900 bg-white px-5 py-4">
            <span className="text-xs font-black uppercase tracking-widest text-neutral-900">
              <span className="font-mono text-sm">{files.length}</span>{" "}
              {files.length === 1 ? "image" : "images"} queued
            </span>
            <div className="flex items-center gap-6">
              <button
                onClick={(e) => { e.stopPropagation(); onClearAll(); }}
                className="cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
              >
                Clear all
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openPicker();
                }}
                className="cursor-pointer rounded-none border-[2px] border-neutral-900 bg-[var(--accent)] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus-visible:outline-none"
              >
                Add more +
              </button>
            </div>
          </div>

          <div
            data-lenis-prevent
            className="dz-scroll grid min-h-0 flex-1 grid-cols-3 gap-5 overflow-y-auto bg-neutral-50 p-5 pr-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
          >
            {files.map((fileObj, i) => (
              <ImagePreview key={fileObj.id} fileObj={fileObj} index={i} onRemove={onRemoveFile} />
            ))}
          </div>

          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[var(--accent)]/90 backdrop-blur-sm transition-opacity duration-200 ${
              isDragging ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="border-[3px] border-neutral-900 bg-white px-6 py-3 text-sm font-black uppercase tracking-widest text-neutral-900 shadow-[4px_4px_0_rgba(17,17,17,1)]">
              Drop to add more images
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="pointer-events-none flex flex-col items-center justify-center px-4 pb-1 text-center">
            <div
              ref={iconRef}
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-none border-[3px] border-neutral-900 bg-[var(--accent)] text-neutral-900 shadow-[4px_4px_0_rgba(17,17,17,1)] transition-colors duration-200 group-hover/dz:bg-white"
            >
              <svg
                className="h-8 w-8"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="square"
                strokeLinejoin="miter"
              >
                <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
              </svg>
            </div>
            <p className="mb-4 text-sm font-black uppercase tracking-widest text-neutral-900 md:text-base">
              {isDragging ? (
                <span>Release to add your images</span>
              ) : (
                <>
                  Click to select files <span className="text-neutral-500">or drag & drop</span>
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="mr-2 font-mono text-[11px] font-bold uppercase tracking-widest text-neutral-400">Supports</span>
              {SUPPORTED.map((t) => (
                <span
                  key={t}
                  className="rounded-none border-[2px] border-neutral-900 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-neutral-900"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        multiple
        accept="image/*,.heic,.heif"
        onChange={handleFileChange}
      />
    </div>
  );
}

export default memo(ImageDropzone);
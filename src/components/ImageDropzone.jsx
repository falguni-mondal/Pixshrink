"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { makeThumbnail } from "@/lib/thumbnail";
import { isImageFile } from "@/lib/fileTypes";
import { PixelMosaic } from "@/components/PixelLoader";

// ---------------------------------------------------------------------------------------
// Design helpers (UI only, no effect on file handling)
// ---------------------------------------------------------------------------------------
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// useLayoutEffect on the client (so tiles are hidden before the first paint), plain useEffect on the server
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DZ_CSS = `
.dz-scroll{scrollbar-width:thin;scrollbar-color:#d4d4d4 transparent;overscroll-behavior:contain}
.dz-scroll::-webkit-scrollbar{width:8px}
.dz-scroll::-webkit-scrollbar-track{background:transparent}
.dz-scroll::-webkit-scrollbar-thumb{background:#d4d4d4;border-radius:9999px;border:2px solid transparent;background-clip:content-box}
.dz-scroll::-webkit-scrollbar-thumb:hover{background:#a3a3a3;background-clip:content-box}
`;

const SUPPORTED = ["JPG", "PNG", "WEBP", "HEIC"];

// memo: with hundreds of files, progress updates in the parent must not re-render every preview.
const ImagePreview = memo(function ImagePreview({ fileObj, onRemove }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const holderRef = useRef(null);
  const removingRef = useRef(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;

    const controller = new AbortController();
    let objectUrl = "";
    let started = false;

    // Only build the thumbnail once the tile scrolls into view; the queue
    // in lib/thumbnail.js keeps at most 2 full images decoding at a time.
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
          if (error?.name !== "AbortError") setFailed(true);
        });
    };

    let observer = null;
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
    };
  }, [fileObj.file]);

  // Stop any running tile animation when the tile goes away
  useEffect(() => {
    const el = holderRef.current;
    return () => {
      if (el) gsap.killTweensOf(el);
    };
  }, []);

  // Shrink the tile away, then remove it from the queue
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
    <div ref={holderRef} data-tile className="group/tile relative aspect-square rounded-xl bg-white/50 transform-gpu">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={fileObj.file.name || "Preview"}
          width={160}
          height={160}
          decoding="async"
          className="h-full w-full rounded-xl object-cover shadow-sm ring-1 ring-black/5"
        />
      ) : failed ? (
        <div className="flex h-full w-full items-center justify-center rounded-xl border border-neutral-200 bg-neutral-100 p-1 text-center">
          <span className="line-clamp-3 break-all text-[10px] leading-tight text-neutral-500">
            {fileObj.file.name}
          </span>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50">
          <PixelMosaic size={28} grid={4} />
        </div>
      )}

      {url && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100">
          <p className="truncate text-[10px] font-medium text-white">{fileObj.file.name}</p>
        </div>
      )}

      <button
        onClick={handleRemove}
        className="absolute -right-2 -top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-md transition-all duration-200 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100"
        title="Remove image"
        aria-label={`Remove ${fileObj.file.name}`}
      >
        <svg className="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});

// HEIC files often arrive with an empty MIME type, so isImageFile also checks the extension.
const toImages = (list) => Array.from(list).filter(isImageFile);

function ImageDropzone({ files, onFilesAdded, onRemoveFile, onClearAll }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    if (!e.target.files) return;
    const images = toImages(e.target.files);
    if (images.length) onFilesAdded(images);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    const images = toImages(e.dataTransfer.files);
    if (images.length) onFilesAdded(images);
  };

  const handleDragOver = (e) => e.preventDefault();

  // -------------------------------------------------------------------------------------
  // Design + GSAP (everything below only affects how the dropzone looks and moves)
  // -------------------------------------------------------------------------------------
  const isEmpty = files.length === 0;
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0); // dragenter/dragleave also fire for child elements, so count them
  const gridRef = useRef(null);
  const iconRef = useRef(null);
  const antsRef = useRef(null);

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

  // While a file is dragged over the empty zone: marching dashes + a bobbing icon.
  useEffect(() => {
    if (!isDragging || !isEmpty || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      if (iconRef.current) {
        gsap.to(iconRef.current, { y: -6, duration: 0.6, ease: "sine.inOut", yoyo: true, repeat: -1 });
      }
      if (antsRef.current) {
        gsap.to(antsRef.current, { strokeDashoffset: -24, duration: 1, ease: "none", repeat: -1 });
      }
    });
    return () => ctx.revert();
  }, [isDragging, isEmpty]);

  // New tiles rise in with a short stagger (first 48 only, the rest just appear).
  useIsoLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const fresh = Array.from(grid.querySelectorAll("[data-tile]:not([data-seen])"));
    if (!fresh.length) return;
    fresh.forEach((el) => el.setAttribute("data-seen", "1"));
    if (prefersReducedMotion()) return;
    gsap.fromTo(
      fresh.slice(0, 48),
      { opacity: 0, y: 12, scale: 0.94 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.55,
        ease: "power3.out",
        stagger: 0.03,
        overwrite: "auto",
        clearProps: "opacity,transform",
      }
    );
  }, [files]);

  const emptyKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  return (
    <div
      onDrop={(e) => {
        endDrag();
        handleDrop(e);
      }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className={`group/dz relative flex w-full flex-col overflow-hidden rounded-2xl transition-all duration-300 ${
        files.length > 0
          ? `h-72 border bg-white ${isDragging ? "border-neutral-900" : "border-neutral-200"}`
          : `h-56 cursor-pointer items-center justify-center md:h-72 ${
              isDragging ? "bg-neutral-100" : "bg-neutral-50/70 hover:bg-neutral-50"
            }`
      }`}
      onClick={() => {
        if (files.length === 0) fileInputRef.current?.click();
      }}
      {...(isEmpty
        ? { role: "button", tabIndex: 0, "aria-label": "Select images to compress", onKeyDown: emptyKeyDown }
        : {})}
    >
      <style>{DZ_CSS}</style>

      {files.length > 0 ? (
        <div className="flex h-full w-full cursor-default flex-col">
          <div className="z-20 flex shrink-0 items-center justify-between border-b border-neutral-200/80 bg-white/85 px-4 py-3 backdrop-blur-md">
            <span className="text-sm text-neutral-500">
              <span className="font-mono font-semibold text-neutral-900">{files.length}</span>{" "}
              {files.length === 1 ? "image" : "images"} queued
            </span>
            <div className="flex items-center gap-4">
              <button
                onClick={(e) => { e.stopPropagation(); onClearAll(); }}
                className="cursor-pointer text-xs font-medium text-neutral-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
              >
                Clear all
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="cursor-pointer rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-300"
              >
                Add more +
              </button>
            </div>
          </div>

          {/* data-lenis-prevent: lets this grid scroll natively instead of Lenis moving the page */}
          <div
            ref={gridRef}
            data-lenis-prevent
            className="dz-scroll grid min-h-0 flex-1 grid-cols-3 gap-4 overflow-y-auto p-4 pr-5 pt-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
          >
            {files.map((fileObj) => (
              <ImagePreview key={fileObj.id} fileObj={fileObj} onRemove={onRemoveFile} />
            ))}
          </div>

          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/85 backdrop-blur-sm transition-opacity duration-200 ${
              isDragging ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-lg">
              Drop to add more images
            </span>
          </div>
        </div>
      ) : (
        <>
          <svg
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 h-full w-full transition-colors duration-300 ${
              isDragging ? "text-neutral-900" : "text-neutral-300 group-hover/dz:text-neutral-400"
            }`}
          >
            <rect
              ref={antsRef}
              x="1"
              y="1"
              rx="15"
              ry="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="6 6"
              style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
            />
          </svg>

          <div className="pointer-events-none flex flex-col items-center justify-center px-4 pb-1 text-center">
            <div
              ref={iconRef}
              className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-neutral-700 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_20px_-8px_rgba(0,0,0,0.18)] ring-1 ring-black/5 transition-transform duration-500 group-hover/dz:-translate-y-0.5"
            >
              <svg
                className="h-6 w-6"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
              </svg>
            </div>
            <p className="mb-3 text-sm text-neutral-500 md:text-base">
              {isDragging ? (
                <span className="font-semibold text-neutral-900">Release to add your images</span>
              ) : (
                <>
                  <span className="font-semibold text-neutral-900">Click to select files</span> or drag and drop
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-400">Supports</span>
              {SUPPORTED.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-500"
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
        className="hidden"
        multiple
        accept="image/*,.heic,.heif"
        onChange={handleFileChange}
        onClick={(e) => { e.target.value = null }}
      />
    </div>
  );
}

export default memo(ImageDropzone);
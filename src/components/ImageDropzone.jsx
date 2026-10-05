"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { makeThumbnail } from "@/lib/thumbnail";
import { isImageFile } from "@/lib/fileTypes";
import { PixelMosaic } from "@/components/PixelLoader";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// UPGRADED: Brutalist scrollbar styling
const DZ_CSS = `
.dz-scroll{scrollbar-width:thin;scrollbar-color:#111 transparent;overscroll-behavior:contain}
.dz-scroll::-webkit-scrollbar{width:12px; border-left: 3px solid #111;}
.dz-scroll::-webkit-scrollbar-track{background:transparent}
.dz-scroll::-webkit-scrollbar-thumb{background:#111; border: 2px solid #fff;}
.dz-scroll::-webkit-scrollbar-thumb:hover{background:var(--accent);}
`;

const SUPPORTED = ["JPG", "PNG", "WEBP", "HEIC"];

// UPGRADED: The Image Preview tiles are now harsh, solid-bordered squares
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

  useEffect(() => {
    const el = holderRef.current;
    return () => {
      if (el) gsap.killTweensOf(el);
    };
  }, []);

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
    <div ref={holderRef} data-tile className="group/tile relative aspect-square rounded-none border-[3px] border-neutral-900 bg-white transform-gpu shadow-[4px_4px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 hover:shadow-[6px_6px_0_rgba(17,17,17,1)]">
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

      {/* Brutalist Remove Button */}
      <button
        onClick={handleRemove}
        className="absolute -right-3 -top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-none border-[3px] border-neutral-900 bg-white text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-all duration-200 hover:bg-[var(--accent)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 opacity-0 group-hover/tile:opacity-100"
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

  const isEmpty = files.length === 0;
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const gridRef = useRef(null);
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
      className={`group/dz relative flex w-full flex-col overflow-hidden rounded-none border-[3px] border-neutral-900 shadow-[6px_6px_0_rgba(17,17,17,1)] transition-colors duration-200 ${
        files.length > 0
          ? `h-[340px] bg-white`
          : `h-[280px] cursor-pointer items-center justify-center md:h-[340px] ${
              isDragging ? "bg-[var(--accent)]" : "bg-white hover:bg-neutral-50"
            }`
      }`}
      onClick={() => {
        if (files.length === 0) {
          if (fileInputRef.current) fileInputRef.current.value = "";
          fileInputRef.current?.click();
        }
      }}
      {...(isEmpty
        ? { role: "button", tabIndex: 0, "aria-label": "Select images to compress", onKeyDown: emptyKeyDown }
        : {})}
    >
      <style>{DZ_CSS}</style>

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
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  fileInputRef.current?.click(); 
                }}
                className="cursor-pointer rounded-none border-[2px] border-neutral-900 bg-[var(--accent)] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus-visible:outline-none"
              >
                Add more +
              </button>
            </div>
          </div>

          <div
            ref={gridRef}
            data-lenis-prevent
            className="dz-scroll grid min-h-0 flex-1 grid-cols-3 gap-5 overflow-y-auto bg-neutral-50 p-5 pr-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
          >
            {files.map((fileObj) => (
              <ImagePreview key={fileObj.id} fileObj={fileObj} onRemove={onRemoveFile} />
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
      
      {/* 
        CRITICAL MOBILE FIX:
        Using sr-only prevents iOS/Android from blocking the invisible file input.
        Removing the onClick here prevents interrupting the mobile OS gallery intent.
      */}
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
"use client";

import { memo, useEffect, useRef, useState } from "react";
import { makeThumbnail } from "@/lib/thumbnail";
import { PixelMosaic } from "@/components/PixelLoader";

// memo: with hundreds of files, progress updates in the parent must not re-render every preview.
const ImagePreview = memo(function ImagePreview({ fileObj, onRemove }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const holderRef = useRef(null);

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

  return (
    <div ref={holderRef} className="relative aspect-square group bg-white/50 rounded-lg transform-gpu">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={fileObj.file.name || "Preview"}
          width={160}
          height={160}
          decoding="async"
          className="w-full h-full object-cover rounded-lg border border-gray-200 shadow-sm"
        />
      ) : failed ? (
        <div className="w-full h-full rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center p-1 text-center">
          <span className="text-[10px] leading-tight text-gray-500 break-all line-clamp-3">
            {fileObj.file.name}
          </span>
        </div>
      ) : (
        <div className="w-full h-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center">
          <PixelMosaic size={28} grid={4} />
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(fileObj.id);
        }}
        className="cursor-pointer absolute -top-2 -right-2 bg-white text-gray-500 hover:text-red-600 border border-gray-200 rounded-full w-6 h-6 flex items-center justify-center shadow-md transition-colors z-10"
        title="Remove image"
        aria-label={`Remove ${fileObj.file.name}`}
      >
        <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});

const toImages = (list) => Array.from(list).filter((f) => f.type.startsWith("image/"));

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

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={`relative flex flex-col w-full border-2 border-dashed rounded-xl transition-all duration-200 overflow-hidden ${
        files.length > 0
          ? "border-blue-400 bg-blue-50/20 h-72"
          : "border-gray-300 bg-gray-50 hover:bg-gray-100 h-56 md:h-72 items-center justify-center cursor-pointer"
      }`}
      onClick={() => {
        if (files.length === 0) fileInputRef.current?.click();
      }}
    >
      {files.length > 0 ? (
        <div className="w-full h-full flex flex-col cursor-default">
          <div className="sticky top-0 z-20 flex justify-between items-center bg-white/90 backdrop-blur-sm border-b border-blue-100 p-3 px-4">
            <span className="text-sm font-semibold text-blue-800">{files.length} images queued</span>
            <div className="space-x-4">
              <button onClick={(e) => { e.stopPropagation(); onClearAll(); }} className="cursor-pointer text-xs font-medium text-red-500 hover:text-red-700 transition-colors">Clear all</button>
              <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors">Add more +</button>
            </div>
          </div>

          <div className="p-4 overflow-y-auto h-full grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 pt-5 pr-5">
            {files.map((fileObj) => (
              <ImagePreview key={fileObj.id} fileObj={fileObj} onRemove={onRemoveFile} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4 pointer-events-none">
          <svg className="w-12 h-12 mb-4 text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
          </svg>
          <p className="mb-2 text-sm md:text-base text-gray-600"><span className="font-semibold text-gray-900">Click to select files</span> or drag and drop</p>
          <p className="text-xs md:text-sm text-gray-500">Supports JPG, PNG, WEBP</p>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*"
        onChange={handleFileChange}
        onClick={(e) => { e.target.value = null }}
      />
    </div>
  );
}

export default memo(ImageDropzone);
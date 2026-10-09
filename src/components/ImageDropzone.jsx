// "use client";

// import { memo, useCallback, useEffect, useRef, useState } from "react";
// import gsap from "gsap";
// import { makeThumbnail } from "@/lib/thumbnail";
// import { isHeicFile } from "@/lib/fileTypes";
// import { prefersReducedMotion } from "@/lib/device";
// import { PixelMosaic } from "@/components/PixelLoader";

// // Tiles animate in with a pure CSS animation (`backwards` fill), so a tile is always
// // visible as its normal state. If JS is busy or an animation is interrupted, nothing
// // can get stuck at opacity 0.
// const DZ_CSS = `
// .dz-scroll{scrollbar-width:thin;scrollbar-color:#111 transparent;overscroll-behavior:contain}
// .dz-scroll::-webkit-scrollbar{width:12px; border-left: 3px solid #111;}
// .dz-scroll::-webkit-scrollbar-track{background:transparent}
// .dz-scroll::-webkit-scrollbar-thumb{background:#111; border: 2px solid #fff;}
// .dz-scroll::-webkit-scrollbar-thumb:hover{background:var(--accent);}
// @keyframes dz-in{from{opacity:0;transform:translateY(12px) scale(.94)}to{opacity:1;transform:none}}
// .dz-in{animation:dz-in .45s cubic-bezier(.22,1,.36,1) backwards;animation-delay:var(--d,0ms)}
// @keyframes dz-indet{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
// .dz-indet{animation:dz-indet 1.1s ease-in-out infinite}
// @media (prefers-reduced-motion:reduce){.dz-in{animation:none}.dz-indet{animation:none;width:100%}}
// `;

// const SUPPORTED = ["JPG", "PNG", "WEBP", "AVIF", "HEIC"];
// const TOAST_MS = 6000;
// const WAIT_GRACE_MS = 150; // files that arrive this fast need no loader (avoids a flash)
// const WAIT_GIVE_UP_MS = 10000; // safety: never leave the loader up if no "change" ever comes

// // Explicit allow-list. Anything else (SVG, animated GIF, PDFs, folders...) is rejected
// // with a message instead of failing later or vanishing silently.
// const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
// const ALLOWED_EXT = /\.(jpe?g|png|webp|avif|heic|heif)$/i;

// const isSupportedFile = (file) =>
//   isHeicFile(file) ||
//   ALLOWED_TYPES.has(file.type) ||
//   // Some browsers report an empty MIME type, so fall back to the extension.
//   (!file.type && ALLOWED_EXT.test(file.name));

// function splitFiles(list) {
//   const accepted = [];
//   const rejected = [];
//   for (const file of Array.from(list)) {
//     (isSupportedFile(file) ? accepted : rejected).push(file);
//   }
//   return { accepted, rejected };
// }

// function rejectionMessage(rejected) {
//   const names = rejected.slice(0, 2).map((f) => f.name || "unnamed");
//   const more = rejected.length > 2 ? ` and ${rejected.length - 2} more` : "";
//   const noun = rejected.length === 1 ? "file" : "files";
//   return `${rejected.length} ${noun} skipped (${names.join(", ")}${more}). Only JPG, PNG, WEBP, AVIF and HEIC are supported.`;
// }

// const ImagePreview = memo(function ImagePreview({ fileObj, onRemove, index = 0 }) {
//   const [url, setUrl] = useState("");
//   const [failed, setFailed] = useState(false);
//   const holderRef = useRef(null);
//   const removingRef = useRef(false);

//   // Builds the thumbnail only once the tile scrolls into view, and cleans up everything
//   // (pending work, observer, object URL, tweens) in one place.
//   // Keyed on the id, not the file: the parent may swap `file` for an in-memory copy later
//   // (phones, HEIC), and that must not restart the thumbnail.
//   useEffect(() => {
//     const el = holderRef.current;
//     if (!el) return;

//     const controller = new AbortController();
//     let objectUrl = "";
//     let started = false;
//     let observer = null;

//     const start = () => {
//       if (started) return;
//       started = true;
//       makeThumbnail(fileObj.file, { signal: controller.signal })
//         .then((u) => {
//           if (controller.signal.aborted) {
//             URL.revokeObjectURL(u);
//           } else {
//             objectUrl = u;
//             setUrl(u);
//           }
//         })
//         .catch((error) => {
//           if (error?.name !== "AbortError" && !controller.signal.aborted) setFailed(true);
//         });
//     };

//     if (typeof IntersectionObserver === "undefined") {
//       start();
//     } else {
//       observer = new IntersectionObserver(([entry]) => {
//         if (entry.isIntersecting) {
//           start();
//           observer.disconnect();
//         }
//       });
//       observer.observe(el);
//     }

//     return () => {
//       controller.abort();
//       observer?.disconnect();
//       if (objectUrl) URL.revokeObjectURL(objectUrl);
//       gsap.killTweensOf(el);
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [fileObj.id]);

//   const handleRemove = (e) => {
//     e.stopPropagation();
//     const el = holderRef.current;
//     if (!el || removingRef.current || prefersReducedMotion()) {
//       onRemove(fileObj.id);
//       return;
//     }
//     removingRef.current = true;
//     gsap.to(el, {
//       opacity: 0,
//       scale: 0.85,
//       duration: 0.2,
//       ease: "power2.in",
//       overwrite: "auto",
//       onComplete: () => onRemove(fileObj.id),
//     });
//   };

//   return (
//     <div
//       ref={holderRef}
//       data-tile
//       style={{ "--d": `${Math.min(index, 24) * 30}ms` }}
//       className="dz-in group/tile relative aspect-square rounded-none border-[3px] border-neutral-900 bg-white transform-gpu shadow-[4px_4px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 hover:shadow-[6px_6px_0_rgba(17,17,17,1)]"
//     >
//       {url ? (
//         // eslint-disable-next-line @next/next/no-img-element
//         <img
//           src={url}
//           alt={fileObj.file.name || "Preview"}
//           width={160}
//           height={160}
//           decoding="async"
//           className="h-full w-full object-cover"
//         />
//       ) : failed ? (
//         <div className="flex h-full w-full items-center justify-center bg-red-50 p-2 text-center">
//           <span className="line-clamp-3 break-all font-mono text-[10px] font-bold uppercase text-red-600">
//             {fileObj.file.name}
//           </span>
//         </div>
//       ) : (
//         <div className="flex h-full w-full items-center justify-center bg-neutral-100">
//           <PixelMosaic size={28} grid={4} />
//         </div>
//       )}

//       {url && (
//         <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-neutral-900 px-2 py-1.5 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 border-t-[3px] border-neutral-900">
//           <p className="truncate font-mono text-[9px] font-bold uppercase tracking-wider text-white">{fileObj.file.name}</p>
//         </div>
//       )}

//       <button
//         onClick={handleRemove}
//         className="absolute -right-3 -top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-none border-[3px] border-neutral-900 bg-white text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-all duration-200 hover:bg-[var(--accent)] hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100"
//         title="Remove image"
//         aria-label={`Remove ${fileObj.file.name}`}
//       >
//         <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//           <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
//         </svg>
//       </button>
//     </div>
//   );
// });

// function ImageDropzone({ files, adding, onFilesAdded, onRemoveFile, onClearAll }) {
//   const fileInputRef = useRef(null);
//   const toastTimerRef = useRef(null);
//   const [toast, setToast] = useState({ title: "", message: "" });

//   useEffect(() => () => clearTimeout(toastTimerRef.current), []);

//   // The gap between closing the system picker and the files arriving. On phones the browser
//   // has to copy every picked photo (Google Photos, HEIC...) before it fires "change", which
//   // can take seconds with nothing on screen. We can't see inside the picker, but we can see
//   // the page lose and regain focus, so: picker opened -> page left -> page back and still no
//   // "change" after a short grace period -> show the loader. "change" or "cancel" hides it.
//   const [waiting, setWaiting] = useState(false);
//   const pickerOpenRef = useRef(false);
//   const leftRef = useRef(false);
//   const armTimerRef = useRef(null);
//   const giveUpTimerRef = useRef(null);

//   const clearWait = useCallback(() => {
//     pickerOpenRef.current = false;
//     leftRef.current = false;
//     clearTimeout(armTimerRef.current);
//     clearTimeout(giveUpTimerRef.current);
//     setWaiting(false);
//   }, []);

//   useEffect(() => {
//     const onLeave = () => {
//       if (pickerOpenRef.current) leftRef.current = true;
//     };
//     const onReturn = () => {
//       if (!pickerOpenRef.current || !leftRef.current) return;
//       clearTimeout(armTimerRef.current);
//       armTimerRef.current = setTimeout(() => {
//         if (!pickerOpenRef.current) return;
//         setWaiting(true);
//         clearTimeout(giveUpTimerRef.current);
//         giveUpTimerRef.current = setTimeout(clearWait, WAIT_GIVE_UP_MS);
//       }, WAIT_GRACE_MS);
//     };
//     const onVisibility = () => (document.visibilityState === "hidden" ? onLeave() : onReturn());

//     const input = fileInputRef.current;
//     window.addEventListener("blur", onLeave);
//     window.addEventListener("focus", onReturn);
//     document.addEventListener("visibilitychange", onVisibility);
//     input?.addEventListener("cancel", clearWait); // picker closed without choosing anything

//     return () => {
//       window.removeEventListener("blur", onLeave);
//       window.removeEventListener("focus", onReturn);
//       document.removeEventListener("visibilitychange", onVisibility);
//       input?.removeEventListener("cancel", clearWait);
//       clearTimeout(armTimerRef.current);
//       clearTimeout(giveUpTimerRef.current);
//     };
//   }, [clearWait]);

//   const showToast = (title, message) => {
//     clearTimeout(toastTimerRef.current);
//     setToast({ title, message });
//     toastTimerRef.current = setTimeout(() => setToast({ title: "", message: "" }), TOAST_MS);
//   };

//   // The parent enforces the mobile cap and skips duplicates. This only filters by type.
//   const handleFiles = (list) => {
//     const { accepted, rejected } = splitFiles(list);
//     if (rejected.length) showToast("Files Skipped", rejectionMessage(rejected));
//     if (accepted.length) onFilesAdded(accepted);
//   };

//   const openPicker = () => {
//     pickerOpenRef.current = true; // armed: see the "gap" effect above
//     leftRef.current = false;
//     if (fileInputRef.current) fileInputRef.current.value = "";
//     fileInputRef.current?.click();
//   };

//   const handleFileChange = (e) => {
//     clearWait(); // the files have arrived
//     const picked = e.target.files ? Array.from(e.target.files) : [];
//     e.target.value = ""; // lets the same file be picked again later
//     if (picked.length) handleFiles(picked);
//   };

//   const handleDrop = (e) => {
//     e.preventDefault();
//     const dropped = e.dataTransfer?.files;
//     if (dropped?.length) handleFiles(dropped);
//   };

//   const handleDragOver = (e) => e.preventDefault();

//   const isEmpty = files.length === 0;
//   const [isDragging, setIsDragging] = useState(false);
//   const dragDepth = useRef(0);
//   const iconRef = useRef(null);

//   const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
//   const handleDragEnter = (e) => {
//     if (!hasFiles(e)) return;
//     dragDepth.current += 1;
//     setIsDragging(true);
//   };
//   const handleDragLeave = () => {
//     dragDepth.current = Math.max(0, dragDepth.current - 1);
//     if (dragDepth.current === 0) setIsDragging(false);
//   };
//   const endDrag = () => {
//     dragDepth.current = 0;
//     setIsDragging(false);
//   };

//   useEffect(() => {
//     if (!isDragging || !isEmpty || prefersReducedMotion()) return;
//     const ctx = gsap.context(() => {
//       if (iconRef.current) {
//         gsap.to(iconRef.current, { y: -8, duration: 0.4, ease: "steps(4)", yoyo: true, repeat: -1 });
//       }
//     });
//     return () => ctx.revert();
//   }, [isDragging, isEmpty]);

//   const emptyKeyDown = (e) => {
//     if (e.target !== e.currentTarget) return;
//     if (e.key === "Enter" || e.key === " ") {
//       e.preventDefault();
//       openPicker();
//     }
//   };

//   const toastVisible = Boolean(toast.message);

//   return (
//     <div
//       onDrop={(e) => {
//         endDrag();
//         handleDrop(e);
//       }}
//       onDragOver={handleDragOver}
//       onDragEnter={handleDragEnter}
//       onDragLeave={handleDragLeave}
//       className={`group/dz relative flex w-full flex-col overflow-hidden rounded-none border-[3px] border-neutral-900 shadow-[6px_6px_0_rgba(17,17,17,1)] transition-colors duration-200 ${
//         files.length > 0
//           ? `h-[340px] bg-white`
//           : `h-[280px] cursor-pointer items-center justify-center md:h-[340px] ${
//               isDragging ? "bg-[var(--accent)]" : "bg-white hover:bg-neutral-50"
//             }`
//       }`}
//       onClick={(e) => {
//         // Ignore the click the hidden input bubbles up when we open the picker.
//         if (e.target === fileInputRef.current) return;
//         if (files.length === 0) openPicker();
//       }}
//       {...(isEmpty
//         ? { role: "button", tabIndex: 0, "aria-label": "Select images to compress", onKeyDown: emptyKeyDown }
//         : {})}
//     >
//       <style>{DZ_CSS}</style>

//       {/* Brutalist toast, used for skipped (unsupported) files */}
//       <div
//         role="status"
//         aria-live="polite"
//         aria-hidden={!toastVisible}
//         className={`absolute left-4 right-4 top-4 z-50 flex items-start gap-4 rounded-none border-[3px] border-neutral-900 bg-[#FFE600] p-4 shadow-[4px_4px_0_rgba(17,17,17,1)] transition-all duration-300 ${
//           toastVisible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0 pointer-events-none"
//         }`}
//       >
//         <svg className="mt-0.5 h-6 w-6 shrink-0 text-neutral-900" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
//           <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
//         </svg>
//         <div className="min-w-0">
//           <h3 className="text-xs font-black uppercase tracking-wide text-neutral-900">{toast.title}</h3>
//           <p className="mt-1 break-words text-xs font-medium text-neutral-800">{toast.message}</p>
//         </div>
//       </div>

//       {/* Progress strip: shown only while real work runs. `waiting` = the phone is still
//           handing over the picked files (the gap after the picker closes); `adding` = phone
//           HEIC copies. It never blocks the tiles or buttons, so it can't trap the user. */}
//       {(adding || waiting) && (
//         <div
//           role="status"
//           aria-live="polite"
//           className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex items-center gap-4 border-t-[3px] border-neutral-900 bg-[#FFE600] px-5 py-3"
//         >
//           <PixelMosaic size={22} grid={4} />
//           <div className="min-w-0 flex-1">
//             <p className="text-xs font-black uppercase tracking-widest text-neutral-900">
//               {adding ? "Preparing images" : "Loading your images"}
//             </p>
//             <div className="mt-2 h-2.5 w-full overflow-hidden border-[2px] border-neutral-900 bg-white">
//               {adding ? (
//                 <div
//                   className="h-full bg-[var(--accent)] transition-[width] duration-150"
//                   style={{ width: `${adding.total ? (adding.done / adding.total) * 100 : 0}%` }}
//                 />
//               ) : (
//                 <div className="dz-indet h-full w-2/5 bg-[var(--accent)]" />
//               )}
//             </div>
//           </div>
//         </div>
//       )}

//       {files.length > 0 ? (
//         <div className="flex h-full w-full cursor-default flex-col">
//           <div className="z-20 flex shrink-0 items-center justify-between border-b-[3px] border-neutral-900 bg-white px-5 py-4">
//             <span className="text-xs font-black uppercase tracking-widest text-neutral-900">
//               <span className="font-mono text-sm">{files.length}</span>{" "}
//               {files.length === 1 ? "image" : "images"} queued
//             </span>
//             <div className="flex items-center gap-6">
//               <button
//                 onClick={(e) => { e.stopPropagation(); onClearAll(); }}
//                 className="cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
//               >
//                 Clear all
//               </button>
//               <button
//                 onClick={(e) => {
//                   e.stopPropagation();
//                   openPicker();
//                 }}
//                 className="cursor-pointer rounded-none border-[2px] border-neutral-900 bg-[var(--accent)] px-4 py-1.5 text-xs font-black uppercase tracking-widest text-neutral-900 shadow-[2px_2px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[4px_4px_0_rgba(17,17,17,1)] active:translate-y-0 active:translate-x-0 active:shadow-none focus-visible:outline-none"
//               >
//                 Add more +
//               </button>
//             </div>
//           </div>

//           <div
//             data-lenis-prevent
//             className="dz-scroll grid min-h-0 flex-1 grid-cols-3 gap-5 overflow-y-auto bg-neutral-50 p-5 pr-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
//           >
//             {files.map((fileObj, i) => (
//               <ImagePreview key={fileObj.id} fileObj={fileObj} index={i} onRemove={onRemoveFile} />
//             ))}
//           </div>

//           <div
//             aria-hidden="true"
//             className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[var(--accent)]/90 backdrop-blur-sm transition-opacity duration-200 ${
//               isDragging ? "opacity-100" : "opacity-0"
//             }`}
//           >
//             <span className="border-[3px] border-neutral-900 bg-white px-6 py-3 text-sm font-black uppercase tracking-widest text-neutral-900 shadow-[4px_4px_0_rgba(17,17,17,1)]">
//               Drop to add more images
//             </span>
//           </div>
//         </div>
//       ) : (
//         <>
//           <div className="pointer-events-none flex flex-col items-center justify-center px-4 pb-1 text-center">
//             <div
//               ref={iconRef}
//               className="mb-6 flex h-16 w-16 items-center justify-center rounded-none border-[3px] border-neutral-900 bg-[var(--accent)] text-neutral-900 shadow-[4px_4px_0_rgba(17,17,17,1)] transition-colors duration-200 group-hover/dz:bg-white"
//             >
//               <svg
//                 className="h-8 w-8"
//                 aria-hidden="true"
//                 xmlns="http://www.w3.org/2000/svg"
//                 fill="none"
//                 viewBox="0 0 24 24"
//                 stroke="currentColor"
//                 strokeWidth="2.5"
//                 strokeLinecap="square"
//                 strokeLinejoin="miter"
//               >
//                 <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
//               </svg>
//             </div>
//             <p className="mb-4 text-sm font-black uppercase tracking-widest text-neutral-900 md:text-base">
//               {isDragging ? (
//                 <span>Release to add your images</span>
//               ) : (
//                 <>
//                   Click to select files <span className="text-neutral-500">or drag & drop</span>
//                 </>
//               )}
//             </p>
//             <div className="flex flex-wrap items-center justify-center gap-2">
//               <span className="mr-2 font-mono text-[11px] font-bold uppercase tracking-widest text-neutral-400">Supports</span>
//               {SUPPORTED.map((t) => (
//                 <span
//                   key={t}
//                   className="rounded-none border-[2px] border-neutral-900 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-neutral-900"
//                 >
//                   {t}
//                 </span>
//               ))}
//             </div>
//           </div>
//         </>
//       )}

//       <input
//         ref={fileInputRef}
//         type="file"
//         className="sr-only"
//         multiple
//         accept="image/*,.heic,.heif"
//         onChange={handleFileChange}
//       />
//     </div>
//   );
// }

// export default memo(ImageDropzone);


















































"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
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
@keyframes dz-indet{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
.dz-indet{animation:dz-indet 1.1s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.dz-in{animation:none}.dz-indet{animation:none;width:100%}}
`;

const SUPPORTED = ["JPG", "PNG", "WEBP", "AVIF", "HEIC"];
const TOAST_MS = 6000;
const WAIT_GRACE_MS = 150; // files that arrive this fast need no loader (avoids a flash)
const WAIT_GIVE_UP_MS = 10000; // safety: never leave the loader up if no "change" ever comes
const SNAPSHOT_CONCURRENCY = 4; // how many files are copied into memory at once

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

function unreadableMessage(unreadable) {
  const names = unreadable.slice(0, 2).map((f) => f.name || "unnamed");
  const more = unreadable.length > 2 ? ` and ${unreadable.length - 2} more` : "";
  const noun = unreadable.length === 1 ? "file" : "files";
  return `${unreadable.length} ${noun} could not be read (${names.join(", ")}${more}). Try picking ${unreadable.length === 1 ? "it" : "them"} again.`;
}

// ROOT-CAUSE FIX
// A File from <input type="file"> (or a drop) is only a *reference* to the file on disk /
// a content URI. The bytes are read lazily, whenever something first asks for them. If that
// happens late (e.g. a thumbnail built when the tile scrolls into view), the browser may
// already have lost access (revoked URI permission, cloud file re-synced, temp copy removed)
// and throws NotFoundError / NotReadableError even though the file is still there.
// Reading the bytes right away and wrapping them in an in-memory File avoids that.
async function snapshotFile(file) {
  const buffer = await file.arrayBuffer();
  return new File([buffer], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

// Copies files into memory with limited concurrency. Never throws: files that can't be
// read are returned in `unreadable` so the caller can tell the user.
async function snapshotFiles(files, onProgress) {
  const ready = new Array(files.length).fill(null);
  const unreadable = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try {
        ready[i] = await snapshotFile(files[i]);
      } catch {
        unreadable.push(files[i]);
      }
      done += 1;
      onProgress?.(done, files.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, files.length) }, worker)
  );
  return { ready: ready.filter(Boolean), unreadable };
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
  const mountedRef = useRef(true);
  const [toast, setToast] = useState({ title: "", message: "" });

  // Progress of copying freshly picked files into memory (see snapshotFiles).
  const [preparing, setPreparing] = useState(null); // { done, total } | null

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(toastTimerRef.current);
    };
  }, []);

  // The gap between closing the system picker and the files arriving. On phones the browser
  // has to copy every picked photo (Google Photos, HEIC...) before it fires "change", which
  // can take seconds with nothing on screen. We can't see inside the picker, but we can see
  // the page lose and regain focus, so: picker opened -> page left -> page back and still no
  // "change" after a short grace period -> show the loader. "change" or "cancel" hides it.
  const [waiting, setWaiting] = useState(false);
  const pickerOpenRef = useRef(false);
  const leftRef = useRef(false);
  const armTimerRef = useRef(null);
  const giveUpTimerRef = useRef(null);

  const clearWait = useCallback(() => {
    pickerOpenRef.current = false;
    leftRef.current = false;
    clearTimeout(armTimerRef.current);
    clearTimeout(giveUpTimerRef.current);
    setWaiting(false);
  }, []);

  useEffect(() => {
    const onLeave = () => {
      if (pickerOpenRef.current) leftRef.current = true;
    };
    const onReturn = () => {
      if (!pickerOpenRef.current || !leftRef.current) return;
      clearTimeout(armTimerRef.current);
      armTimerRef.current = setTimeout(() => {
        if (!pickerOpenRef.current) return;
        setWaiting(true);
        clearTimeout(giveUpTimerRef.current);
        giveUpTimerRef.current = setTimeout(clearWait, WAIT_GIVE_UP_MS);
      }, WAIT_GRACE_MS);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? onLeave() : onReturn());

    const input = fileInputRef.current;
    window.addEventListener("blur", onLeave);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onVisibility);
    input?.addEventListener("cancel", clearWait); // picker closed without choosing anything

    return () => {
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onVisibility);
      input?.removeEventListener("cancel", clearWait);
      clearTimeout(armTimerRef.current);
      clearTimeout(giveUpTimerRef.current);
    };
  }, [clearWait]);

  const showToast = (title, message) => {
    if (!mountedRef.current) return;
    clearTimeout(toastTimerRef.current);
    setToast({ title, message });
    toastTimerRef.current = setTimeout(() => setToast({ title: "", message: "" }), TOAST_MS);
  };

  // The parent enforces the mobile cap and skips duplicates. This filters by type and,
  // crucially, copies the bytes into memory right away so a later read can't hit a
  // stale file reference ("file not found" although the file exists).
  const handleFiles = async (list) => {
    // Must run synchronously: a drop's FileList can be emptied once the event ends.
    const { accepted, rejected } = splitFiles(list);
    const messages = [];
    if (rejected.length) messages.push(rejectionMessage(rejected));

    if (accepted.length) {
      // Only show the progress strip if copying is not near-instant (avoids a flash).
      let showProgress = false;
      const timer = setTimeout(() => {
        showProgress = true;
        if (mountedRef.current) setPreparing({ done: 0, total: accepted.length });
      }, WAIT_GRACE_MS);

      const { ready, unreadable } = await snapshotFiles(accepted, (done, total) => {
        if (showProgress && mountedRef.current) setPreparing({ done, total });
      });

      clearTimeout(timer);
      if (mountedRef.current) setPreparing(null);

      if (unreadable.length) messages.push(unreadableMessage(unreadable));
      if (ready.length && mountedRef.current) onFilesAdded(ready);
    }

    if (messages.length) showToast("Files Skipped", messages.join(" "));
  };

  const openPicker = () => {
    pickerOpenRef.current = true; // armed: see the "gap" effect above
    leftRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    clearWait(); // the files have arrived
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

  // `adding` comes from the parent (phone/HEIC copies); `preparing` is our own copy step.
  const progress = adding || preparing;

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

      {/* Brutalist toast, used for skipped (unsupported / unreadable) files */}
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

      {/* Progress strip: shown only while real work runs. `waiting` = the phone is still
          handing over the picked files (the gap after the picker closes); `progress` =
          copying the picked files into memory (ours) or phone HEIC copies (parent's).
          It never blocks the tiles or buttons, so it can't trap the user. */}
      {(progress || waiting) && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex items-center gap-4 border-t-[3px] border-neutral-900 bg-[#FFE600] px-5 py-3"
        >
          <PixelMosaic size={22} grid={4} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-neutral-900">
              {progress ? "Preparing images" : "Loading your images"}
            </p>
            <div className="mt-2 h-2.5 w-full overflow-hidden border-[2px] border-neutral-900 bg-white">
              {progress ? (
                <div
                  className="h-full bg-[var(--accent)] transition-[width] duration-150"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              ) : (
                <div className="dz-indet h-full w-2/5 bg-[var(--accent)]" />
              )}
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
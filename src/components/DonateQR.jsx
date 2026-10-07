"use client";

// Styled, animated QR drawn as inline SVG: one <rect> per dark module.
//
// Scan safety rules (do not break these when editing):
//  - Data modules are always hard black on white, with a 4 module quiet margin.
//  - Finder squares keep the 1:1:3:1:1 dark/light ratio: black ring, light ring (white +
//    a yellow overlay that only pulses its opacity), solid black 3x3 center. A yellow
//    CENTER would read as light and break the pattern, so the accent lives in the ring.
//  - The center logo covers about 5% of the code, well inside error correction level H.
//  - After the build-in, modules never move on their own. Only the thin scanline and the
//    finder ring colour animate, and both pause when the QR is off-screen.
//  - Hover ripple (desktop mouse only) briefly lifts nearby modules, then returns them.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { generateQrMatrix, isFinderModule } from "@/lib/donate";
import { prefersReducedMotion } from "@/lib/device";
import { PixelMosaic } from "@/components/PixelLoader";

const QUIET = 4; // quiet margin, in modules (the QR spec asks for 4)
const LOGO_FRACTION = 0.22; // logo box side as a fraction of the code side (about 5% of area)
const MIN_SIZE = 220; // px
const BUILD_MS = 1400; // build-in length; effects start after this
const RIPPLE_RADIUS = 3.2; // modules
const RIPPLE_LIFT = 0.45; // extra scale at the pointer

const QR_CSS = `
@keyframes dq-pop{0%{transform:scale(0);opacity:0}70%{transform:scale(1.25);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes dq-fade{from{opacity:0}to{opacity:1}}
@keyframes dq-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes dq-scan{
  0%{opacity:0;transform:translateY(0)}
  2%{opacity:.85}
  12%{opacity:.85;transform:translateY(var(--dq-h))}
  14%,100%{opacity:0;transform:translateY(var(--dq-h))}
}
.dq-m{transform-box:fill-box;transform-origin:center}
.dq-building .dq-m{animation:dq-pop .4s ease-out backwards;animation-delay:var(--d,0ms)}
.dq-building .dq-f{animation:dq-fade .5s ease-out backwards}
.dq-ready .dq-fy{animation:dq-pulse 2.6s ease-in-out 1.5s infinite}
.dq-ready .dq-scan{animation:dq-scan 8s linear 3s infinite}
.dq-scan{opacity:0}
.dq[data-paused="true"] .dq-fy,.dq[data-paused="true"] .dq-scan{animation-play-state:paused}
@media (prefers-reduced-motion:reduce){
  .dq-building .dq-m,.dq-building .dq-f,.dq-ready .dq-fy,.dq-ready .dq-scan{animation:none}
}
`;

// Round cat face, drawn in a 100 x 100 box. Sits on a white backing so it never touches data.
function CatLogo({ x, y, side }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${side / 100})`}>
      <rect width="100" height="100" rx="20" fill="#fff" />
      {/* ears */}
      <polygon points="19,44 22,12 47,28" fill="#F59E3B" />
      <polygon points="81,44 78,12 53,28" fill="#F59E3B" />
      <polygon points="27,37 28,21 40,29" fill="#F4A8A0" />
      <polygon points="73,37 72,21 60,29" fill="#F4A8A0" />
      {/* head */}
      <circle cx="50" cy="58" r="34" fill="#F59E3B" stroke="#C9741C" strokeWidth="2" />
      {/* tabby marks */}
      <path d="M50 26v9M42 28l2 8M58 28l-2 8" stroke="#C9741C" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      {/* eyes */}
      <ellipse cx="37" cy="55" rx="4" ry="5" fill="#2B1A0E" />
      <ellipse cx="63" cy="55" rx="4" ry="5" fill="#2B1A0E" />
      <circle cx="38.4" cy="53.2" r="1.4" fill="#fff" />
      <circle cx="64.4" cy="53.2" r="1.4" fill="#fff" />
      {/* muzzle */}
      <ellipse cx="50" cy="69" rx="11" ry="8" fill="#FBD9A8" />
      <path d="M46 63h8l-4 5z" fill="#E8837A" />
      <path d="M50 68v3M50 71q-3 3-6 1M50 71q3 3 6 1" stroke="#2B1A0E" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      {/* whiskers */}
      <path d="M30 66l-14-3M30 70l-14 2M70 66l14-3M70 70l14 2" stroke="#8A5214" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

/**
 * @param {{ value: string, size?: number, label?: string }} props
 *   value: the text to encode (the upi://pay link).
 *   size: width in px (never below 220, and it shrinks to fit narrow containers).
 *   label: text alternative for screen readers (include the UPI ID).
 */
function DonateQR({ value, size = 260, label = "UPI payment QR code" }) {
  const px = Math.max(MIN_SIZE, size);
  const [state, setState] = useState({ status: "loading", qr: null });
  const [phase, setPhase] = useState("building"); // "building" | "ready"
  const [attempt, setAttempt] = useState(0);

  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const cellsRef = useRef(null); // Map "row,col" -> <rect>, built once the code is ready
  const lastCellRef = useRef("");

  // Build the matrix (this also downloads the qrcode library the first time).
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", qr: null });
    generateQrMatrix(value)
      .then((qr) => {
        if (!cancelled) setState({ status: "ready", qr });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", qr: null });
      });
    return () => {
      cancelled = true;
    };
  }, [value, attempt]);

  // Build-in, then the calm "ready" phase where scanning is easiest.
  useEffect(() => {
    if (state.status !== "ready") return;
    if (prefersReducedMotion()) {
      setPhase("ready"); // the finished code appears instantly
      return;
    }
    setPhase("building");
    const t = setTimeout(() => setPhase("ready"), BUILD_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Layout: which modules to draw, which area the logo owns, and each module's delay.
  const geo = useMemo(() => {
    const qr = state.qr;
    if (!qr) return null;
    const { size: n, modules } = qr;

    let k = Math.round(n * LOGO_FRACTION);
    if ((n - k) % 2 !== 0) k += 1; // keep the logo centered on the module grid
    const start = (n - k) / 2;

    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!modules[r][c]) continue;
        if (isFinderModule(r, c, n)) continue; // drawn separately
        if (r >= start && r < start + k && c >= start && c < start + k) continue; // logo area
        // Top-to-bottom sweep with a little randomness: a "scanline" build.
        const delay = Math.round((r / n) * 650 + Math.random() * 220);
        cells.push({ r, c, delay });
      }
    }
    const finders = [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ];
    return { n, total: n + QUIET * 2, k, start, cells, finders };
  }, [state.qr]);

  // Pause the looping effects while the QR is off-screen (saves battery).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      el.dataset.paused = entry.isIntersecting ? "false" : "true";
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Index the module rects for the hover ripple once the code is calm.
  useEffect(() => {
    const svg = svgRef.current;
    if (phase !== "ready" || !geo || !svg) return;
    const map = new Map();
    svg.querySelectorAll("rect[data-r]").forEach((el) => {
      map.set(`${el.dataset.r},${el.dataset.c}`, el);
    });
    cellsRef.current = map;
    return () => {
      gsap.killTweensOf(Array.from(map.values()));
      cellsRef.current = null;
    };
  }, [phase, geo]);

  const onPointerMove = (e) => {
    const map = cellsRef.current;
    if (e.pointerType !== "mouse" || phase !== "ready" || !map || !geo) return;
    if (prefersReducedMotion()) return;

    const box = svgRef.current.getBoundingClientRect();
    const unit = box.width / geo.total;
    const cx = (e.clientX - box.left) / unit - QUIET - 0.5; // pointer, in module coordinates
    const cy = (e.clientY - box.top) / unit - QUIET - 0.5;
    const key = `${Math.round(cy)},${Math.round(cx)}`;
    if (key === lastCellRef.current) return; // same module as last time
    lastCellRef.current = key;

    const r0 = Math.round(cy);
    const c0 = Math.round(cx);
    const reach = Math.ceil(RIPPLE_RADIUS);
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        const el = map.get(`${r},${c}`);
        if (!el) continue;
        const d = Math.hypot(r - cy, c - cx);
        if (d > RIPPLE_RADIUS) continue;
        // fromTo (not to) so the yoyo always lands back on exactly scale 1.
        gsap.fromTo(
          el,
          { scale: 1 },
          {
            scale: 1 + (1 - d / RIPPLE_RADIUS) * RIPPLE_LIFT,
            duration: 0.16,
            ease: "power2.out",
            yoyo: true,
            repeat: 1,
            overwrite: true,
            transformOrigin: "50% 50%",
          },
        );
      }
    }
  };

  const onPointerLeave = () => {
    lastCellRef.current = "";
  };

  const frame =
    "w-full aspect-square rounded-none border-[3px] border-neutral-900 bg-white shadow-[6px_6px_0_rgba(17,17,17,1)]";

  return (
    <div
      ref={rootRef}
      data-paused="false"
      className="dq max-w-full"
      style={{ width: px, maxWidth: "100%" }}
    >
      <style>{QR_CSS}</style>

      {state.status === "loading" && (
        <div
          role="status"
          aria-label="Making your QR code"
          className={`${frame} flex items-center justify-center`}
        >
          <PixelMosaic size={36} grid={4} />
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className={`${frame} flex flex-col items-center justify-center gap-4 p-5 text-center`}>
          <p className="text-xs font-black uppercase tracking-wide text-red-600">
            The QR code could not be made
          </p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="cursor-pointer rounded-none border-[3px] border-neutral-900 bg-[var(--accent)] px-4 py-2 text-xs font-black uppercase tracking-wider text-neutral-900 shadow-[3px_3px_0_rgba(17,17,17,1)] transition-transform hover:-translate-y-0.5 hover:translate-x-0.5 hover:shadow-[5px_5px_0_rgba(17,17,17,1)] active:translate-x-0 active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-900/30"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && geo && (
        <div role="img" aria-label={label} className={frame}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${geo.total} ${geo.total}`}
            className={`block h-full w-full ${phase === "ready" ? "dq-ready" : "dq-building"}`}
            style={{ "--dq-h": `${geo.total}px` }}
            shapeRendering="crispEdges"
            aria-hidden="true"
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
          >
            <rect width={geo.total} height={geo.total} fill="#ffffff" />

            {/* data modules: always black */}
            <g fill="#111111">
              {geo.cells.map(({ r, c, delay }) => (
                <rect
                  key={`${r}-${c}`}
                  className="dq-m"
                  data-r={r}
                  data-c={c}
                  x={QUIET + c}
                  y={QUIET + r}
                  width="1"
                  height="1"
                  style={{ "--d": `${delay}ms` }}
                />
              ))}
            </g>

            {/* finder squares: black ring, light ring (white + yellow overlay), black center */}
            {geo.finders.map(([r0, c0]) => {
              const x = QUIET + c0;
              const y = QUIET + r0;
              return (
                <g key={`f-${r0}-${c0}`} className="dq-f">
                  <rect x={x} y={y} width="7" height="7" fill="#111111" />
                  <rect x={x + 1} y={y + 1} width="5" height="5" fill="#ffffff" />
                  <rect
                    className="dq-fy"
                    x={x + 1}
                    y={y + 1}
                    width="5"
                    height="5"
                    fill="var(--accent)"
                  />
                  <rect x={x + 2} y={y + 2} width="3" height="3" fill="#111111" />
                </g>
              );
            })}

            <g className="dq-f">
              <CatLogo x={QUIET + geo.start} y={QUIET + geo.start} side={geo.k} />
            </g>

            {/* thin scanline: sweeps once every few seconds, only in the ready phase */}
            <rect className="dq-scan" x="0" y="-0.6" width={geo.total} height="0.6" fill="var(--accent)" />
          </svg>
        </div>
      )}
    </div>
  );
}

export default memo(DonateQR);
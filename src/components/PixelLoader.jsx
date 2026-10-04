"use client";

// THE LOADER: a tiny 8x8 "photo" (dusk sky, low sun, ridge line) made of separate pixels.
// On a loop the pixels fuse into 2x2 blocks, then 4x4 blocks, then split back apart.
// That is literally what lossy compression does, so the animation explains the app.
//
// Render <PixelStyles /> once near the root of the app (keyframes live there).

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));

// Deterministic scene, so the server and client always agree.
function scenePixel(fx, fy) {
  const ridge = 0.64 + 0.09 * Math.sin(fx * 7.2) + 0.05 * Math.sin(fx * 15 + 1.3);
  if (fy > ridge) return mix([34, 44, 84], [14, 20, 44], clamp((fy - ridge) * 3, 0, 1));
  const sun = Math.hypot(fx - 0.68, (fy - 0.5) * 1.1);
  if (sun < 0.15) return [255, 228, 160];
  const sky = mix([58, 74, 168], [255, 156, 118], clamp(fy / ridge, 0, 1));
  return sun < 0.28 ? mix(sky, [255, 205, 140], ((0.28 - sun) / 0.13) * 0.6) : sky;
}

const css = (c) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;
const tileCache = {};

function buildTiles(grid) {
  if (tileCache[grid]) return tileCache[grid];

  const base = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) base.push(scenePixel((x + 0.5) / grid, (y + 0.5) / grid));
  }

  const blockAverage = (x, y, size) => {
    const bx = Math.floor(x / size) * size;
    const by = Math.floor(y / size) * size;
    const sum = [0, 0, 0];
    let n = 0;
    for (let j = by; j < Math.min(by + size, grid); j++) {
      for (let i = bx; i < Math.min(bx + size, grid); i++) {
        const c = base[j * grid + i];
        sum[0] += c[0];
        sum[1] += c[1];
        sum[2] += c[2];
        n++;
      }
    }
    return sum.map((v) => v / n);
  };

  tileCache[grid] = base.map((color, idx) => {
    const x = idx % grid;
    const y = Math.floor(idx / grid);
    return {
      key: idx,
      c0: css(color), // original pixel
      c1: css(blockAverage(x, y, 2)), // fused into 2x2
      c2: css(blockAverage(x, y, 4)), // fused into 4x4
      delay: (Math.floor(x / 2) + Math.floor(y / 2)) * 110, // blocks fuse in a diagonal wave
    };
  });
  return tileCache[grid];
}

const STYLES = `
@keyframes px-crunch {
  0%, 10%   { background-color: var(--c0); transform: scale(.84); }
  30%, 40%  { background-color: var(--c1); transform: scale(1); }
  60%, 70%  { background-color: var(--c2); transform: scale(1); }
  92%, 100% { background-color: var(--c0); transform: scale(.84); }
}
@keyframes px-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes px-rise {
  from { opacity: 0; transform: translateY(10px) scale(.98) }
  to   { opacity: 1; transform: none }
}
.px-tile { animation: px-crunch 4.2s cubic-bezier(.65, 0, .35, 1) infinite both; }
.px-tile-static { transform: scale(.88); }
.px-fade { animation: px-fade .25s ease-out both; }
.px-rise { animation: px-rise .4s cubic-bezier(.2, .8, .2, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .px-tile { animation: none; transform: scale(.88); }
  .px-fade, .px-rise { animation: none; }
}
`;

export function PixelStyles() {
  return <style>{STYLES}</style>;
}

export function PixelMosaic({ size = 96, grid = 8, animated = true, className = "" }) {
  const tiles = buildTiles(grid);
  return (
    <div
      aria-hidden="true"
      className={`grid shrink-0 overflow-hidden bg-gray-200 ${className}`}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${grid}, 1fr)`,
        borderRadius: Math.round(size * 0.22),
      }}
    >
      {tiles.map((t) => (
        <span
          key={t.key}
          className={animated ? "px-tile" : "px-tile-static"}
          style={{
            "--c0": t.c0,
            "--c1": t.c1,
            "--c2": t.c2,
            backgroundColor: t.c0,
            animationDelay: `${t.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function LoadingOverlay({ title, detail, progress, onCancel, cancelling = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="px-fade fixed inset-0 z-50 flex items-center justify-center bg-white/80 px-6 backdrop-blur-md"
    >
      <div className="flex flex-col items-center text-center">
        <PixelMosaic size={120} />
        <p className="mt-8 text-base font-semibold text-gray-900">{title}</p>
        {detail && <p className="mt-1 max-w-xs text-sm text-gray-500">{detail}</p>}

        {typeof progress === "number" && (
          <div className="mt-6 h-1 w-56 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-gray-900 transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {onCancel && (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="mt-6 cursor-pointer text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-default disabled:opacity-60"
          >
            {cancelling ? "Finishing the current images…" : "Stop early"}
          </button>
        )}
      </div>
    </div>
  );
}
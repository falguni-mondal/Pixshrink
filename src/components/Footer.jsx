import Link from "next/link";

// Add links here once the pages exist, for example:
//   { label: "Privacy", href: "/privacy" },
//   { label: "Terms", href: "/terms" },
const LINKS = [];

export default function Footer() {
  const year = new Date().getFullYear();

  // The marquee text repeated to ensure it fills even ultrawide monitors
  const textGroup = "✦ 100% FREE ✦ ZERO UPLOADS ✦ PRIVATE BY DESIGN ✦ LOCAL COMPRESSION ";
  const marqueeText = textGroup.repeat(5);

  return (
    <footer className="mt-auto w-full border-t-[3px] border-neutral-900 bg-white">
      
      {/* 1. The Infinite Marquee Tape */}
      <div className="flex w-full overflow-hidden border-b-[3px] border-neutral-900 bg-[var(--accent)] py-2.5 text-neutral-900">
        {/* We use two spans to create a seamless infinite loop */}
        <div className="flex w-max animate-[marquee_25s_linear_infinite] items-center whitespace-nowrap font-mono text-sm font-bold uppercase tracking-widest">
          <span className="shrink-0">{marqueeText}</span>
          <span className="shrink-0">{marqueeText}</span>
        </div>
      </div>

      {/* 2. The Standard Footer Links */}
      <div className="mx-auto w-full max-w-[1760px] px-4 sm:px-6 lg:px-10 2xl:px-14">
        <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-pixel)] text-lg leading-none tracking-tight text-neutral-900">
              Pix<span className="text-[var(--accent)] drop-shadow-[1px_1px_0_rgba(17,17,17,1)]">Shrink</span>
            </span>
            <span className="font-mono text-[11px] font-bold text-neutral-500">&copy; {year}</span>
          </div>

          {LINKS.length > 0 && (
            <nav aria-label="Footer">
              <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {LINKS.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-xs font-bold text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-500">
            Batch image compressor
          </p>
        </div>
      </div>
    </footer>
  );
}
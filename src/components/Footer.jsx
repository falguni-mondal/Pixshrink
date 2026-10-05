import Link from "next/link";

// Add links here once the pages exist, for example:
//   { label: "Privacy", href: "/privacy" },
//   { label: "Terms", href: "/terms" },
//   { label: "About", href: "/about" },
//   { label: "Contact", href: "/contact" },
// While the list is empty, no nav is rendered at all (no dead links).
const LINKS = [];

// Server component: no client JavaScript. Rendered once in app/layout.js.
export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto w-full">
      <div className="mx-auto w-full max-w-[1760px] px-4 sm:px-6 lg:px-10 2xl:px-14">
        <div className="flex flex-col gap-4 border-t border-neutral-200/80 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-pixel)] text-lg leading-none tracking-tight text-neutral-900">
              Pix<span className="text-neutral-500">Shrink</span>
            </span>
            <span className="font-mono text-[11px] text-neutral-500">&copy; {year}</span>
          </div>

          {LINKS.length > 0 && (
            <nav aria-label="Footer">
              <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {LINKS.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-xs text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            Batch image compressor
          </p>
        </div>
      </div>
    </footer>
  );
}
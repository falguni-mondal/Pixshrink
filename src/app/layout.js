import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import SmoothScroll from "@/components/SmoothScroll";
import Footer from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pixel font for the PixShrink wordmark (SIL Open Font License, free for commercial use).
// It is a variable font (weights 400-700). Use it in components with:
//   className="font-[family-name:var(--font-pixel)]"
const pixelFont = Pixelify_Sans({
  variable: "--font-pixel",
  subsets: ["latin"],
});

export const metadata = {
  applicationName: "PixShrink",
  // Other pages (privacy, about...) can set just `title: "Privacy"` and get "Privacy | PixShrink".
  title: {
    default: "PixShrink | Batch image compressor",
    template: "%s | PixShrink",
  },
  description: "Compress, resize and convert images in bulk, right in your browser.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixelFont.variable} h-full antialiased`}
    >
      {/* The page background and text color live on <body> so the footer and any overscroll
          area match the app (and don't flip dark if globals.css has a dark-mode default). */}
      <body
        suppressHydrationWarning
        className="flex min-h-full flex-col bg-[#f7f6f3] text-neutral-900"
      >
        <SmoothScroll>
          {children}
          <Footer />
        </SmoothScroll>
      </body>
    </html>
  );
}
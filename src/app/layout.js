import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import SmoothScroll from "@/components/SmoothScroll";
import Footer from "@/components/Footer";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixelFont = Pixelify_Sans({
  variable: "--font-pixel",
  subsets: ["latin"],
});

export const metadata = {
  applicationName: "PixShrink",
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
      <body
        suppressHydrationWarning
        // REMOVED: bg-[#f7f6f3] so globals.css can apply the Dot Matrix background!
        className="flex min-h-full flex-col text-neutral-900"
      >
        <SmoothScroll>
          {children}
          <Analytics />
          <Footer />
        </SmoothScroll>
      </body>
    </html>
  );
}
import CompressorApp from "@/components/CompressorApp";
import { isImageKitEnabled } from "@/lib/imagekitConfig";

// Runs on the server (at build time on Vercel or any other platform), per request in `next dev`.
// Only a boolean reaches the browser, never the keys themselves.
export default function Page() {
  return <CompressorApp imagekitAvailable={isImageKitEnabled()} />;
}
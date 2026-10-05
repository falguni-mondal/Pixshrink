// Copies the HEIC decoder from node_modules into public/ so the app can serve it itself.
// Runs automatically after `npm install` (see "postinstall" in package.json),
// which also means it runs on Vercel before the build.
import { cpSync, existsSync, mkdirSync } from "node:fs";

const source = "node_modules/libheif-js/libheif-wasm/libheif-bundle.js";
const targetDir = "public/libheif";

if (!existsSync(source)) {
  console.warn(
    `[copy-libheif] ${source} not found. Run "npm install libheif-js" first. HEIC support stays off until then.`
  );
  process.exit(0); // never fail the install
}

mkdirSync(targetDir, { recursive: true });
cpSync(source, `${targetDir}/libheif-bundle.js`);
console.log(`[copy-libheif] HEIC decoder copied to ${targetDir}/libheif-bundle.js`);

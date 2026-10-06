"use client";

import { useState } from "react";
import { encodeAvif } from "@/lib/avifEncode";

export default function AvifTest() {
  const [width, setWidth] = useState(1080);
  const [cq, setCq] = useState(33);
  const [speed, setSpeed] = useState(6);
  const [log, setLog] = useState([]);
  const [url, setUrl] = useState("");

  const add = (line) => setLog((l) => [...l, line]);

  const run = async (file) => {
    if (!file) return;
    setLog([]);
    setUrl("");
    try {
      add(`crossOriginIsolated: ${self.crossOriginIsolated}`);
      add(`cores: ${navigator.hardwareConcurrency}`);
      add(`input: ${file.name}, ${(file.size / 1024).toFixed(0)} KB`);

      const bitmap = await createImageBitmap(file, { resizeWidth: Number(width) });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      add(`pixels: ${canvas.width} x ${canvas.height}`);

      const t0 = performance.now();
      const blob = await encodeAvif(imageData, { cqLevel: Number(cq), speed: Number(speed) });
      const secs = ((performance.now() - t0) / 1000).toFixed(2);

      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      const sig = String.fromCharCode(...head.subarray(4, 12));
      add(`OK: ${(blob.size / 1024).toFixed(0)} KB in ${secs}s, header "${sig}"`);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      add(`FAILED: ${e?.name}: ${e?.message}`);
      console.error(e);
    }
  };

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>AVIF smoke test (temporary)</h1>
      <p>
        width <input type="number" value={width} onChange={(e) => setWidth(e.target.value)} />{" "}
        cqLevel <input type="number" value={cq} onChange={(e) => setCq(e.target.value)} />{" "}
        speed <input type="number" value={speed} onChange={(e) => setSpeed(e.target.value)} />
      </p>
      <input type="file" accept="image/*" onChange={(e) => run(e.target.files?.[0])} />
      <pre>{log.join("\n")}</pre>
      {url && <img src={url} alt="AVIF result" style={{ maxWidth: 400 }} />}
    </main>
  );
}
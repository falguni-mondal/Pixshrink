import { NextResponse } from "next/server";
import { isImageKitEnabled } from "@/lib/imagekitConfig";

// Created lazily: `new ImageKit({...})` throws when keys are missing, which would
// otherwise crash the build on a deployment that has no ImageKit env vars.
let client = null;
async function getImageKit() {
  if (!client) {
    const { default: ImageKit } = await import("imagekit");
    client = new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    });
  }
  return client;
}

export async function POST(request) {
  // The route simply doesn't exist unless the ImageKit engine is enabled.
  if (!isImageKitEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let imagekit = null;
  let uploadResponse = null;

  try {
    imagekit = await getImageKit();

    const data = await request.formData();
    const file = data.get("file");
    const width = data.get("width");
    const quality = data.get("quality");
    const format = data.get("format");

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Convert the incoming file to a Node.js Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Upload original image to ImageKit
    uploadResponse = await imagekit.upload({
      file: buffer,
      fileName: file.name,
      folder: "/local_batch_compressor",
    });

    // 2. Generate the exact transformation URL based on your slider inputs
    const transformUrl = imagekit.url({
      src: uploadResponse.url,
      transformation: [{
        width: width,
        quality: quality,
        format: format,
      }],
    });

    // 3. Fetch the newly compressed image from ImageKit
    const response = await fetch(transformUrl);
    if (!response.ok) {
      throw new Error(`ImageKit transformation failed (${response.status})`);
    }
    const compressedBuffer = Buffer.from(await response.arrayBuffer());

    // Return the compressed binary data as a base64 string to the frontend
    const base64Data = compressedBuffer.toString("base64");

    // Ensure the filename extension matches the new format
    const baseName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;

    return NextResponse.json({
      success: true,
      fileName: `${baseName}_compressed.${format}`,
      data: base64Data,
    });
  } catch (error) {
    console.error("Compression error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    // 4. Always delete the original from ImageKit, even if a step above failed.
    if (imagekit && uploadResponse?.fileId) {
      try {
        await imagekit.deleteFile(uploadResponse.fileId);
      } catch (cleanupError) {
        console.error("ImageKit cleanup failed:", cleanupError.message);
      }
    }
  }
}
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function createAssetKey(fileName: string) {
  const extension = path.extname(fileName).toLowerCase() || ".bin";
  return `assets/listing-ai/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
}

function createAssetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing upload file." }, { status: 400 });
    }

    if (file.type && !supportedImageTypes.has(file.type)) {
      return NextResponse.json({ error: "Only image files are supported." }, { status: 400 });
    }

    const key = createAssetKey(file.name);
    const storedObject = await getStorageDriver().putFile({ key, file });

    return NextResponse.json({
      asset: {
        id: storedObject.key,
        name: file.name,
        type: file.type || storedObject.contentType || "application/octet-stream",
        size: storedObject.size,
        createdAt: new Date().toISOString(),
        url: createAssetUrl(storedObject.key),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import path from "node:path";
import { NextResponse } from "next/server";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function getContentType(key: string) {
  return contentTypes[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

function isValidAssetKey(keyParts: string[]) {
  return (
    keyParts.length > 1 &&
    keyParts[0] === "assets" &&
    keyParts.every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"))
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const { key: keyParts } = await params;

    if (!isValidAssetKey(keyParts)) {
      return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    }

    const key = keyParts.join("/");
    const buffer = await getStorageDriver().getBuffer(key);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": getContentType(key),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset download failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

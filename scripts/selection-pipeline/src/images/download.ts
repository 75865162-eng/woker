import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RateLimit } from "../amazon/rateLimit";
import { PipelineError } from "../io";
export async function downloadImage(url: string, asin: string, dir: string, limit: RateLimit) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !["m.media-amazon.com", "images-na.ssl-images-amazon.com", "images.amazon.com"].includes(u.hostname)) throw new PipelineError("INVALID_IMAGE_HOST");
  await limit.reserve();
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new PipelineError("IMAGE_DOWNLOAD_FAILED");
  const max = 10 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > max) { await response.body?.cancel(); throw new PipelineError("IMAGE_TOO_LARGE"); }
  const chunks: Uint8Array[] = []; let size = 0;
  if (!response.body) throw new PipelineError("EMPTY_IMAGE");
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new PipelineError("IMAGE_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = await sharp(Buffer.concat(chunks), { limitInputPixels: 25000000 }).rotate().jpeg({ quality: 90 }).toBuffer();
  const target = path.join(dir, `raw/images/${asin}.jpg`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return `raw/images/${asin}.jpg`;
}

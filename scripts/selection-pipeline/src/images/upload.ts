import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProductImageAsset } from "@/lib/products/types";
import { PipelineError } from "../io";
// Same endpoint/contract as uploadProductImageAsset in src/lib/products/image-assets.ts.
// Node has no browser session: explicit ERP origin + session cookie are required.
export async function uploadImage(file: string, workspaceId: string): Promise<ProductImageAsset | undefined> {
  const origin = process.env.SELECTION_ERP_URL;
  const cookie = process.env.SELECTION_ERP_COOKIE;
  if (!origin || !cookie) return undefined;
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new PipelineError("INSECURE_ERP_ORIGIN");
  const form = new FormData();
  form.append("file", new Blob([await readFile(file)], { type: "image/jpeg" }), path.basename(file));
  form.append("workspaceId", workspaceId); form.append("marketplace", "US");
  const response = await fetch(new URL("/api/products/file-assets/upload", url), { method: "POST", headers: { Cookie: cookie }, body: form, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new PipelineError("ERP_IMAGE_UPLOAD_FAILED");
  const body = await response.json() as { asset?: ProductImageAsset };
  if (!body.asset?.id) throw new PipelineError("INVALID_UPLOAD_RESPONSE");
  return body.asset;
}

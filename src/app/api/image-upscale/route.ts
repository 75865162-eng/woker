import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getImageUpscaleModel, isImageUpscaleModel } from "@/lib/image-upscale/models";
import type { ImageKind, NoiseLevel, ImageUpscaleScale } from "@/lib/image-upscale/types";
import { prisma } from "@/lib/db/prisma";
import { enqueueImageUpscaleJob } from "@/lib/queue";
import { getStorageDriver } from "@/lib/storage";

export const runtime = "nodejs";

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 50 * 1024 * 1024;
const maxFiles = 20;
const maxBatchSize = 200 * 1024 * 1024;

function getExtension(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
    ? extension
    : file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
}

function parseOptions(formData: FormData) {
  const scale = String(formData.get("scale") ?? "2");
  const imageKind = String(formData.get("imageKind") ?? "photo");
  const noiseLevel = String(formData.get("noiseLevel") ?? "low");
  const modelValue = String(formData.get("model") ?? "");
  if (!["2", "4"].includes(scale) || !["illustration", "photo"].includes(imageKind) || !["none", "low", "medium", "high"].includes(noiseLevel) || (modelValue && !isImageUpscaleModel(modelValue))) {
    throw new Error("图片处理参数无效。");
  }
  return {
    scale: Number(scale) as ImageUpscaleScale,
    imageKind: imageKind as ImageKind,
    noiseLevel: noiseLevel as NoiseLevel,
    model: (modelValue || getImageUpscaleModel(imageKind as ImageKind, noiseLevel as NoiseLevel)) as ReturnType<typeof getImageUpscaleModel>,
  };
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("imageUpscale", "create", request);
    if (!permission.ok) return permission.response;
    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const legacyFile = formData.get("file");
    if (files.length === 0 && legacyFile instanceof File) files.push(legacyFile);
    if (files.length === 0) return NextResponse.json({ error: "请至少上传一张图片。" }, { status: 400 });
    if (files.length > maxFiles) return NextResponse.json({ error: `一次最多上传 ${maxFiles} 张图片。` }, { status: 400 });
    if (files.reduce((sum, file) => sum + file.size, 0) > maxBatchSize) return NextResponse.json({ error: "单批图片总大小不能超过 200MB。" }, { status: 400 });
    const options = parseOptions(formData);
    for (const file of files) {
      if (!supportedTypes.has(file.type)) return NextResponse.json({ error: `${file.name} 不是支持的 JPG、PNG 或 WebP 图片。` }, { status: 400 });
      if (file.size > maxFileSize) return NextResponse.json({ error: `${file.name} 不能超过 50MB。` }, { status: 400 });
    }

    const { user } = permission;
    const storage = getStorageDriver();
    const batchId = randomUUID();
    const jobs = [];
    const storedKeys: string[] = [];
    try {
      for (const file of files) {
        const jobId = randomUUID();
        const inputKey = `image-upscale/inputs/${new Date().toISOString().slice(0, 10)}/${jobId}${getExtension(file)}`;
        const stored = await storage.putFile({ key: inputKey, file });
        storedKeys.push(stored.key);
        jobs.push(await prisma.imageUpscaleJob.create({
          data: {
            id: jobId, organizationId: user.organizationId, userId: user.id, batchId,
            originalName: file.name, mimeType: file.type, inputKey: stored.key, inputSize: stored.size,
            scale: options.scale, imageKind: options.imageKind, noiseLevel: options.noiseLevel, model: options.model,
          },
        }));
      }
      await Promise.all(jobs.map((job) => enqueueImageUpscaleJob(job.id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片任务入队失败。";
      await prisma.imageUpscaleJob.updateMany({ where: { batchId, organizationId: user.organizationId }, data: { status: "failed", error: message } });
      await Promise.all(storedKeys.map((key) => storage.delete(key).catch(() => undefined)));
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return NextResponse.json({ batchId, jobs }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片任务创建失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("imageUpscale", "view", request);
    if (!permission.ok) return permission.response;
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, maxFiles);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
    const jobs = await prisma.imageUpscaleJob.findMany({
      where: {
        organizationId: permission.user.organizationId,
        ...(ids.length ? { id: { in: ids } } : {}),
        ...(url.searchParams.get("batchId") ? { batchId: url.searchParams.get("batchId")! } : {}),
      },
      orderBy: { createdAt: "desc" },
      ...(ids.length ? {} : { take: limit }),
    });
    return NextResponse.json({ jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片历史读取失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

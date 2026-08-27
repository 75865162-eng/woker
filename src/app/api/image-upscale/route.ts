import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getStorageDriver } from "@/lib/storage";
import type { StorageDriver } from "@/lib/storage/types";

export const runtime = "nodejs";

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 50 * 1024 * 1024;
const maxLogLength = 4000;

type ImageKind = "illustration" | "photo";
type NoiseLevel = "none" | "low" | "medium" | "high";

function getEnginePath() {
  return path.resolve(process.cwd(), process.env.REALESRGAN_NCNN_EXE ?? "tools/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan.exe");
}

function getModelName(imageKind: ImageKind, noiseLevel: NoiseLevel) {
  if (imageKind === "illustration") {
    return noiseLevel === "high" ? "realesrgan-x4plus-anime" : "realesr-animevideov3";
  }

  return "realesrgan-x4plus";
}

function getExtension(file: File) {
  const extension = path.extname(file.name).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg" || extension === ".png" || extension === ".webp") {
    return extension;
  }

  if (file.type === "image/png") {
    return ".png";
  }

  if (file.type === "image/webp") {
    return ".webp";
  }

  return ".jpg";
}

function isValidScale(value: string): value is "2" | "4" {
  return value === "2" || value === "4";
}

function isValidImageKind(value: string): value is ImageKind {
  return value === "illustration" || value === "photo";
}

function isValidNoiseLevel(value: string): value is NoiseLevel {
  return value === "none" || value === "low" || value === "medium" || value === "high";
}

function requireLocalPathStorage(storage: StorageDriver) {
  if (!storage.getLocalPath) {
    throw new Error("Image upscale currently requires a storage driver with local file paths.");
  }

  return storage.getLocalPath.bind(storage);
}

function runRealEsrgan(input: {
  enginePath: string;
  inputPath: string;
  outputPath: string;
  modelName: string;
  scale: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-i",
      input.inputPath,
      "-o",
      input.outputPath,
      "-n",
      input.modelName,
      "-s",
      input.scale,
      "-f",
      "png",
      "-t",
      process.env.REALESRGAN_TILE_SIZE ?? "256",
    ];

    if (process.env.REALESRGAN_GPU_ID) {
      args.push("-g", process.env.REALESRGAN_GPU_ID);
    }

    const child = spawn(input.enginePath, args, {
      cwd: path.dirname(input.enginePath),
      windowsHide: true,
    });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-maxLogLength);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-maxLogLength);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.trim() || `Real-ESRGAN exited with code ${code}.`));
    });
  });
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("imageUpscale", "create", request);

  if (!permission.ok) {
    return permission.response;
  }

  const jobId = randomUUID();
  const storage = getStorageDriver();
  const getLocalPath = requireLocalPathStorage(storage);
  const workKey = `image-upscale/${new Date().toISOString().slice(0, 10)}/${jobId}`;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const scaleValue = String(formData.get("scale") ?? "2");
    const imageKindValue = String(formData.get("imageKind") ?? "photo");
    const noiseLevelValue = String(formData.get("noiseLevel") ?? "low");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先上传一张图片。" }, { status: 400 });
    }

    if (!supportedTypes.has(file.type)) {
      return NextResponse.json({ error: "仅支持 JPG、PNG 和 WebP 图片。" }, { status: 400 });
    }

    if (file.size > maxFileSize) {
      return NextResponse.json({ error: "图片不能超过 50MB。" }, { status: 400 });
    }

    if (!isValidScale(scaleValue) || !isValidImageKind(imageKindValue) || !isValidNoiseLevel(noiseLevelValue)) {
      return NextResponse.json({ error: "图片处理参数无效。" }, { status: 400 });
    }

    const enginePath = getEnginePath();
    const inputKey = `${workKey}/input${getExtension(file)}`;
    const outputKey = `${workKey}/result.png`;
    const inputPath = getLocalPath(inputKey);
    const outputPath = getLocalPath(outputKey);
    const modelName = getModelName(imageKindValue, noiseLevelValue);

    await storage.putFile({ key: inputKey, file });
    await runRealEsrgan({
      enginePath,
      inputPath,
      outputPath,
      modelName,
      scale: scaleValue,
    });

    const result = await storage.getBuffer(outputKey);
    const body = new Uint8Array(result);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const fileName = encodeURIComponent(`${baseName}-${scaleValue}x-ai-upscaled.png`);

    return new Response(body, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "X-Image-Upscale-Model": modelName,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 图片放大失败。";

    if (message.includes("ENOENT")) {
      return NextResponse.json(
        {
          error: "未找到 Real-ESRGAN 引擎。请先运行 npm run setup:realesrgan，或在 .env 中配置 REALESRGAN_NCNN_EXE。",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await storage.deletePrefix?.(workKey);
  }
}

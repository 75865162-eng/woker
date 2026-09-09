import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { getStorageDriver } from "@/lib/storage";
import { getRealEsrganEnginePath } from "@/lib/image-upscale/config";
import type { ImageUpscaleScale } from "@/lib/image-upscale/types";

const maxLogLength = 4000;

function runRealEsrgan(input: {
  enginePath: string;
  inputPath: string;
  outputPath: string;
  modelName: string;
  scale: ImageUpscaleScale;
}) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-i", input.inputPath, "-o", input.outputPath, "-n", input.modelName, "-s", String(input.scale),
      "-f", "png", "-t", process.env.REALESRGAN_TILE_SIZE ?? "256",
    ];
    if (process.env.REALESRGAN_GPU_ID) args.push("-g", process.env.REALESRGAN_GPU_ID);

    const child = spawn(input.enginePath, args, {
      cwd: path.dirname(input.enginePath),
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-maxLogLength); });
    child.stderr.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-maxLogLength); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(output.trim() || `Real-ESRGAN exited with code ${code}.`));
    });
  });
}

export async function processImageUpscale(input: {
  inputKey: string;
  outputKey: string;
  scale: ImageUpscaleScale;
  model: string;
}) {
  const storage = getStorageDriver();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "amazon-image-upscale-"));
  const inputPath = path.join(tempDir, "input");
  const outputPath = path.join(tempDir, "output.png");
  const startedAt = Date.now();

  try {
    const inputBuffer = await storage.getBuffer(input.inputKey);
    await writeFile(inputPath, inputBuffer);
    const inputMeta = await sharp(inputBuffer).metadata();
    await runRealEsrgan({
      enginePath: getRealEsrganEnginePath(),
      inputPath,
      outputPath,
      modelName: input.model,
      scale: input.scale,
    });
    const outputBuffer = await readFile(outputPath);
    const outputMeta = await sharp(outputBuffer).metadata();
    await storage.putBuffer({ key: input.outputKey, buffer: outputBuffer, contentType: "image/png" });

    return {
      model: input.model,
      inputWidth: inputMeta.width ?? null,
      inputHeight: inputMeta.height ?? null,
      outputWidth: outputMeta.width ?? null,
      outputHeight: outputMeta.height ?? null,
      outputSize: outputBuffer.byteLength,
      processingMs: Date.now() - startedAt,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

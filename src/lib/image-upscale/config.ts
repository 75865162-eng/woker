import path from "node:path";

export function getRealEsrganEnginePath() {
  const configured = process.env.REALESRGAN_NCNN_EXE?.trim() || process.env.REALESRGAN_NCNN_BIN?.trim();
  if (configured) {
    return path.resolve(process.cwd(), configured);
  }

  return path.resolve(
    process.cwd(),
    process.platform === "win32"
      ? "tools/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan.exe"
      : "tools/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan",
  );
}

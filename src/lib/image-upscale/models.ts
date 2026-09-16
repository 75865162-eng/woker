import type { ImageKind, NoiseLevel } from "@/lib/image-upscale/types";

export const imageUpscaleModels = [
  { value: "realesrgan-x4plus", label: "Real-ESRGAN x4plus" },
  { value: "realesr-animevideov3", label: "Real-ESRGAN AnimeVideoV3" },
  { value: "realesrgan-x4plus-anime", label: "Real-ESRGAN x4plus Anime" },
] as const;

export type ImageUpscaleModel = (typeof imageUpscaleModels)[number]["value"];

export function isImageUpscaleModel(value: string): value is ImageUpscaleModel {
  return imageUpscaleModels.some((model) => model.value === value);
}

export function getImageUpscaleModel(imageKind: ImageKind, noiseLevel: NoiseLevel): ImageUpscaleModel {
  if (imageKind === "illustration") {
    return noiseLevel === "high" ? "realesrgan-x4plus-anime" : "realesr-animevideov3";
  }

  return "realesrgan-x4plus";
}

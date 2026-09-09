export type ImageKind = "illustration" | "photo";
export type NoiseLevel = "none" | "low" | "medium" | "high";
export type ImageUpscaleScale = 2 | 4;

export type ImageUpscaleJobPayload = {
  jobId: string;
};

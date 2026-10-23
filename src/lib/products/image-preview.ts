import sharp from "sharp";

const previewMaxDimension = 1600;
const previewQuality = 70;

export async function createProductImagePreview(input: Buffer) {
  return sharp(input)
    .rotate()
    .resize({
      width: previewMaxDimension,
      height: previewMaxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: previewQuality })
    .toBuffer();
}

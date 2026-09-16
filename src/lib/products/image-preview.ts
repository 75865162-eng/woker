import sharp from "sharp";

const previewTargetBytes = 150 * 1024;
const previewMinBytes = 120 * 1024;
const previewMaxBytes = 180 * 1024;
const previewMaxDimension = 1600;
const previewDimensions = [1, 0.88, 0.76, 0.64, 0.52, 0.4, 0.3];
const previewQualities = [82, 76, 70, 64, 58, 52, 46, 40, 34, 28, 22, 18];

export async function createProductImagePreview(input: Buffer) {
  const metadata = await sharp(input).metadata();
  const sourceDimension = Math.max(metadata.width ?? previewMaxDimension, metadata.height ?? previewMaxDimension);
  const maxDimension = Math.min(previewMaxDimension, sourceDimension);
  let best: { buffer: Buffer; distance: number } | undefined;

  for (const scale of previewDimensions) {
    const dimension = Math.max(1, Math.round(maxDimension * scale));

    for (const quality of previewQualities) {
      const buffer = await sharp(input)
        .rotate()
        .resize({
          width: dimension,
          height: dimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer();

      const bytes = buffer.byteLength;
      if (bytes >= previewMinBytes && bytes <= previewMaxBytes) {
        return buffer;
      }

      const distance = Math.abs(bytes - previewTargetBytes);
      if (!best || distance < best.distance) {
        best = { buffer, distance };
      }
    }
  }

  return best?.buffer ?? input;
}

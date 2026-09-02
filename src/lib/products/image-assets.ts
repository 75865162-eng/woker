export function getProductListImage(product: { image?: string; images?: string[] }) {
  const image = product.image?.trim() || product.images?.[0]?.trim();

  return image || "";
}

export async function uploadProductImageAsset(file: File) {
  return await fileToDataUrl(file);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

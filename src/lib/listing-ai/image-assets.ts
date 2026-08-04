export interface ListingAiImageAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  url?: string;
  blob: Blob;
}

export async function saveListingAiImageAsset(file: File) {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch("/api/assets/upload", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json()) as {
    asset?: Omit<ListingAiImageAsset, "blob"> & { url: string };
    error?: string;
  };

  if (!response.ok || !data.asset) {
    throw new Error(data.error ?? "Failed to upload Listing AI image asset.");
  }

  return {
    ...data.asset,
    blob: file,
  };
}

export async function readListingAiImageAsset(id: string) {
  if (!id.startsWith("assets/")) {
    return undefined;
  }

  const response = await fetch(`/api/assets/${id.split("/").map(encodeURIComponent).join("/")}`);

  if (!response.ok) {
    return undefined;
  }

  const blob = await response.blob();
  const name = id.split("/").pop() || "image";

  return {
    id,
    name,
    type: blob.type,
    size: blob.size,
    createdAt: "",
    url: response.url,
    blob,
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}

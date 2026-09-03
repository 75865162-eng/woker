export interface ListingAiImageAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  url?: string;
  blob: Blob;
}

export async function saveListingAiImageAsset(
  file: File,
  options?: {
    onUploadProgress?: (progress: number) => void;
  },
) {
  const uploadFile = await compressListingAiImage(file);
  const formData = new FormData();
  formData.set("file", uploadFile);

  return await new Promise<ListingAiImageAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/assets/upload");
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !options?.onUploadProgress) {
        return;
      }

      options.onUploadProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}") as {
          asset?: Omit<ListingAiImageAsset, "blob"> & { url: string };
          error?: string;
        };

        if (xhr.status < 200 || xhr.status >= 300 || !data.asset) {
          reject(new Error(data.error ?? "Failed to upload Listing AI image asset."));
          return;
        }

        resolve({
          ...data.asset,
          blob: uploadFile,
        });
      } catch {
        reject(new Error("Failed to upload Listing AI image asset."));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Failed to upload Listing AI image asset."));
    };

    xhr.send(formData);
  });
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

async function compressListingAiImage(file: File) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return file;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob) {
      return file;
    }

    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, ".webp"), {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

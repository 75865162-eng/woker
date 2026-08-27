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
  const formData = new FormData();
  formData.set("file", file);

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
          blob: file,
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

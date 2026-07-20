export interface ListingAiImageAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  url?: string;
  blob: Blob;
}

const databaseName = "listing-ai-image-assets";
const databaseVersion = 1;
const storeName = "assets";

function openImageAssetsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open Listing AI image storage."));
  });
}

function runAssetTransaction<T>(
  mode: IDBTransactionMode,
  runner: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  return openImageAssetsDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = runner(transaction.objectStore(storeName));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("Listing AI image storage failed."));
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("Listing AI image storage failed."));
        };
      }),
  );
}

export function createListingAiImageAssetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `listing-image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  if (id.startsWith("assets/")) {
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

  return runAssetTransaction<ListingAiImageAsset | undefined>("readonly", (store) => store.get(id));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}

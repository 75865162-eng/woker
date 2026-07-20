import { localStorageDriver } from "@/lib/storage/local-storage";
import { createS3StorageDriver } from "@/lib/storage/s3-storage";
import type { StorageDriver } from "@/lib/storage/types";

export function getStorageDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  if (driver === "local") {
    return localStorageDriver;
  }

  if (driver === "s3" || driver === "r2") {
    return createS3StorageDriver();
  }

  throw new Error(`Unsupported storage driver: ${driver}`);
}

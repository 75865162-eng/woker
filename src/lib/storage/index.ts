import { localStorageDriver } from "@/lib/storage/local-storage";
import { createS3StorageDriver } from "@/lib/storage/s3-storage";
import type { StorageDriver } from "@/lib/storage/types";
import type { FileStorageType } from "@prisma/client";

export function getStorageType(): FileStorageType {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  if (driver === "local" || driver === "s3" || driver === "r2") {
    return driver;
  }

  throw new Error(`Unsupported storage driver: ${driver}`);
}

export function getStorageDriver(): StorageDriver {
  const driver = getStorageType();

  if (driver === "local") {
    return localStorageDriver;
  }

  if (driver === "s3" || driver === "r2") {
    return createS3StorageDriver();
  }

  throw new Error(`Unsupported storage driver: ${driver}`);
}

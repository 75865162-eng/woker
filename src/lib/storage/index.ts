import { localStorageDriver } from "@/lib/storage/local-storage";
import { createS3StorageDriver } from "@/lib/storage/s3-storage";
import type { StorageDriver } from "@/lib/storage/types";
import type { FileStorageType } from "@prisma/client";

const productionR2Bucket = "amazon-bulk-uploads";

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
    assertSafeRemoteStorage(driver);
    return createS3StorageDriver();
  }

  throw new Error(`Unsupported storage driver: ${driver}`);
}

function assertSafeRemoteStorage(driver: FileStorageType) {
  if (
    driver === "r2" &&
    process.env.NODE_ENV !== "production" &&
    process.env.S3_BUCKET === productionR2Bucket &&
    process.env.ALLOW_PRODUCTION_R2_IN_LOCAL !== "true"
  ) {
    throw new Error(
      "Local development is configured to use the production R2 bucket. Use STORAGE_DRIVER=local or a dev bucket, or set ALLOW_PRODUCTION_R2_IN_LOCAL=true for a temporary explicit override.",
    );
  }
}

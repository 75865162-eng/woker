import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageDriver, StoredObject } from "@/lib/storage/types";

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for S3 storage.`);
  }

  return value;
}

function createS3Client() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: getRequiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("S3 object body is not readable.");
  }

  const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

export function createS3StorageDriver(): StorageDriver {
  const client = createS3Client();
  const bucket = getRequiredEnv("S3_BUCKET");

  return {
    async putFile({ key, file }): Promise<StoredObject> {
      const buffer = Buffer.from(await file.arrayBuffer());
      return this.putBuffer({ key, buffer, contentType: file.type || undefined });
    },

    async putBuffer({ key, buffer, contentType }): Promise<StoredObject> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      return {
        key,
        size: buffer.byteLength,
        contentType,
      };
    },

    async getBuffer(key) {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      return streamToBuffer(response.Body);
    },

    async delete() {
      // Delete support can be added when lifecycle cleanup is wired into the app.
    },
  };
}

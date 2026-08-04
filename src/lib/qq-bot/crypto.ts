import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function deriveSeed(secret: string) {
  const secretBytes = Buffer.from(secret, "utf8");
  if (secretBytes.length === 0) {
    throw new Error("QQ_BOT_SECRET 不能为空。");
  }

  const seed = Buffer.alloc(32);
  for (let index = 0; index < seed.length; index += 1) {
    seed[index] = secretBytes[index % secretBytes.length];
  }
  return seed;
}

function createEd25519PrivateKey(secret: string) {
  const seed = deriveSeed(secret);

  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function signQqBotValidation(secret: string, eventTimestamp: string, plainToken: string) {
  const privateKey = createEd25519PrivateKey(secret);
  return sign(null, Buffer.from(`${eventTimestamp}${plainToken}`, "utf8"), privateKey).toString("hex");
}

export function verifyQqBotRequest(secret: string, timestamp: string | null, signatureHex: string | null, rawBody: string) {
  if (!timestamp || !signatureHex) return false;

  const signature = Buffer.from(signatureHex, "hex");
  if (signature.length !== 64) return false;

  const privateKey = createEd25519PrivateKey(secret);
  const publicKey = createPublicKey(privateKey);
  return verify(null, Buffer.from(`${timestamp}${rawBody}`, "utf8"), publicKey, signature);
}

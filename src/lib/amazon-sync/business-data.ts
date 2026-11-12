import type { Prisma } from "@prisma/client";
import { readFinanceJson, WireDecimal } from "./finance";

// A fixed secret boundary, never a per-user field allowlist. Unknown business
// fields and nested objects survive Schema additions without new grants.
const secretKeys = new Set([
  "authorization", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "securitytoken",
  "clientsecret", "password", "passwordhash", "secret", "secretkey", "privatekey", "apikey",
  "awsaccesskeyid", "awssecretaccesskey", "secretaccesskey", "credentials", "credentialsciphertext",
  "tokenhash", "cookie", "setcookie", "downloadurl", "signedurl", "presignedurl",
  "token", "nexttoken", "paginationtoken", "continuationtoken", "headers", "mcptoken", "mcpkey",
]);

export function amazonBusinessData(value: Prisma.JsonValue, depth = 0): Prisma.JsonValue {
  if (depth > 100) throw new Error("Business data exceeds supported nesting depth");
  if (typeof value === "string") {
    if (/^(?:Bearer\s+|amcp_[A-Za-z0-9_-]{43}$)/i.test(value) || /[?&](?:X-Amz-Signature|access_token|refresh_token)=/i.test(value)) return "[REDACTED_SECRET]";
    return value;
  }
  if (Array.isArray(value)) return value.map(item => amazonBusinessData(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return !secretKeys.has(normalized) && !normalized.endsWith("ciphertext");
  }).flatMap(([key, item]) => item === undefined ? [] : [[key, amazonBusinessData(item, depth + 1)]]));
}

/** Decode stored JSON without passing numeric tokens through JavaScript Number. */
export function parseAmazonBusinessJson(text: string): Prisma.JsonValue {
  const exact = (value: ReturnType<typeof readFinanceJson>): Prisma.JsonValue => {
    if (value instanceof WireDecimal) return value.source;
    if (Array.isArray(value)) return value.map(exact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, exact(child)]));
    return value;
  };
  return amazonBusinessData(exact(readFinanceJson(text)));
}

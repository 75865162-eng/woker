import { getPublicOrigin } from "../auth/request-security";

export function isSellfoxSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site")?.trim().toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const incoming = new URL(origin);
    if (!["http:", "https:"].includes(incoming.protocol) || incoming.origin !== origin) return false;
    return incoming.origin === getPublicOrigin(request);
  } catch { return false; }
}

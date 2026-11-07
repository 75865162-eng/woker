import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { validateAmazonMcpCredential } from "@/lib/amazon-sync/mcp";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { exchangePairing } from "./device-pairing";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const invalid = () => new SyncInputError("invalid_grant", 400);
export function liliOAuthOrigin(request: Request) {
  const configured = process.env.LILI_PUBLIC_ORIGIN;
  const url = new URL(configured || request.url);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new SyncInputError("OAuth requires HTTPS or loopback.", 503);
  // Never derive a production issuer from arbitrary Host/Forwarded headers.
  if (!configured && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new SyncInputError("LILI_PUBLIC_ORIGIN is required.", 503);
  if (configured && (url.pathname !== "/" || url.search || url.hash)) throw new SyncInputError("Invalid OAuth origin.", 503);
  return url.origin;
}
export function liliOAuthMetadata(request: Request) {
  const origin = liliOAuthOrigin(request), base = origin + "/api/lili/oauth";
  return { issuer: origin, authorization_endpoint: base + "/authorize", token_endpoint: base + "/token", registration_endpoint: base + "/register", revocation_endpoint: base + "/revoke", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["lili"] };
}
export function validRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const u = new URL(value); return !u.username && !u.password && !u.hash && (u.protocol === "https:" || u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)); } catch { return false; }
}
export async function registerLiliClient(body: Record<string, unknown>) {
  if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 5 || !body.redirect_uris.every(validRedirect) || body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none" || body.grant_types && (!Array.isArray(body.grant_types) || body.grant_types.some(g => !["authorization_code", "refresh_token"].includes(String(g)))) || body.response_types && (!Array.isArray(body.response_types) || body.response_types.some(t => t !== "code"))) throw new SyncInputError("invalid_client_metadata", 400);
  // Public native clients only; registration never fetches client-supplied URLs.
  const client = await prisma.liliOAuthClient.create({ data: { id: randomUUID(), redirectUris: [...new Set(body.redirect_uris as string[])] } });
  return { client_id: client.id, redirect_uris: client.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
}
export async function validateAuthorization(params: URLSearchParams, request: Request) {
  if ([...params.keys()].some(k => params.getAll(k).length !== 1)) throw new SyncInputError("invalid_request", 400);
  const clientId = params.get("client_id") || "", redirectUri = params.get("redirect_uri") || "";
  const client = await prisma.liliOAuthClient.findUnique({ where: { id: clientId } });
  if (!client || !client.redirectUris.includes(redirectUri)) throw new SyncInputError("invalid_redirect_uri", 400);
  const challenge = params.get("code_challenge") || "", resource = params.get("resource") || "";
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || resource !== liliOAuthOrigin(request) + "/api/lili/mcp" || params.has("scope") && params.get("scope") !== "lili" || (params.get("state")?.length ?? 0) > 2048) throw new SyncInputError("invalid_request", 400);
  return { clientId, redirectUri, challenge, resource };
}
export async function authorizeLili(params: URLSearchParams, request: Request, pairingId: string, pairingCode: string) {
  const fields = await validateAuthorization(params, request), code = secret();
  await exchangePairing(pairingId, pairingCode, "Codex OAuth", async (tx, device) => {
    await tx.liliOAuthGrant.create({ data: { id: randomUUID(), ...fields, deviceId: device.id, codeHash: hash(code), codeExpiresAt: new Date(Date.now() + 60_000), expiresAt: device.expiresAt } });
    // The temporary pairing bearer is never disclosed or usable.
    await tx.amazonMcpCredential.update({ where: { id: device.id }, data: { expiresAt: new Date() } });
  });
  const redirect = new URL(fields.redirectUri);
  redirect.searchParams.set("code", code);
  if (params.has("state")) redirect.searchParams.set("state", params.get("state")!);
  return redirect.toString();
}
export async function exchangeLiliToken(params: URLSearchParams, request: Request) {
  if ([...params.keys()].some(k => params.getAll(k).length !== 1)) throw invalid();
  const kind = params.get("grant_type"), clientId = params.get("client_id") || "";
  if (!["authorization_code", "refresh_token"].includes(kind || "")) throw new SyncInputError("unsupported_grant_type", 400);
  const presented = params.get(kind === "authorization_code" ? "code" : "refresh_token") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(presented)) throw invalid();
  const refresh = kind === "refresh_token" ? await prisma.liliOAuthRefresh.findUnique({ where: { hash: hash(presented) } }) : null;
  const found = kind === "authorization_code" ? await prisma.liliOAuthGrant.findUnique({ where: { codeHash: hash(presented) } }) : refresh ? await prisma.liliOAuthGrant.findUnique({ where: { id: refresh.grantId } }) : null;
  if (!found || found.clientId !== clientId || found.resource !== liliOAuthOrigin(request) + "/api/lili/mcp" || params.has("resource") && params.get("resource") !== found.resource) throw invalid();
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', "lili-oauth:" + found.id);
    await tx.$queryRawUnsafe('SELECT id FROM "AmazonMcpCredential" WHERE id = $1 FOR UPDATE', found.deviceId);
    const grant = await tx.liliOAuthGrant.findUniqueOrThrow({ where: { id: found.id } });
    if (grant.revokedAt || grant.expiresAt <= new Date()) return null;
    if (kind === "authorization_code") {
      const verifier = params.get("code_verifier") || "";
      if (grant.codeUsedAt || grant.codeExpiresAt <= new Date() || params.get("redirect_uri") !== grant.redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash("sha256").update(verifier).digest("base64url") !== grant.challenge) return null;
      await tx.liliOAuthGrant.update({ where: { id: grant.id }, data: { codeUsedAt: new Date() } });
    } else {
      const current = await tx.liliOAuthRefresh.findUnique({ where: { hash: hash(presented) } });
      if (!current || current.consumedAt) {
        // Replay invalidates the whole device, including the most recent access token.
        await tx.liliOAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
        await tx.amazonMcpCredential.update({ where: { id: grant.deviceId }, data: { status: "REVOKED", revision: { increment: 1 } } });
        const device = await tx.amazonMcpCredential.findUniqueOrThrow({ where: { id: grant.deviceId } });
        await tx.auditLog.create({ data: { organizationId: device.organizationId, userId: device.userId, action: "lili.oauth.refresh.replay_denied", entityType: "AmazonMcpCredential", entityId: device.id, metadata: { workspaceId: device.workspaceId, clientId } } });
        return null;
      }
      await tx.liliOAuthRefresh.update({ where: { hash: current.hash }, data: { consumedAt: new Date() } });
    }
    const device = await tx.amazonMcpCredential.findUnique({ where: { id: grant.deviceId } });
    await validateAmazonMcpCredential(device, true);
    const access = "amcp_" + secret(), nextRefresh = secret(), expiresAt = new Date(Math.min(grant.expiresAt.getTime(), Date.now() + 3600_000));
    await tx.amazonMcpCredential.update({ where: { id: grant.deviceId }, data: { tokenHash: hash(access), tokenPrefix: access.slice(0, 12), expiresAt, revision: { increment: 1 } } });
    await tx.liliOAuthRefresh.create({ data: { hash: hash(nextRefresh), grantId: grant.id } });
    await tx.auditLog.create({ data: { organizationId: device!.organizationId, userId: device!.userId, action: "lili.oauth.token." + (kind === "refresh_token" ? "refreshed" : "issued"), entityType: "AmazonMcpCredential", entityId: grant.deviceId, metadata: { workspaceId: device!.workspaceId, clientId } } });
    return { access_token: access, token_type: "Bearer", expires_in: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)), refresh_token: nextRefresh, scope: "lili" };
  });
  if (!result) throw invalid();
  return result;
}
export async function revokeLiliToken(params: URLSearchParams) {
  const value = params.get("token") || "", clientId = params.get("client_id") || "";
  if (value.length > 200) return;
  const refresh = await prisma.liliOAuthRefresh.findUnique({ where: { hash: hash(value) } });
  const device = value.startsWith("amcp_") ? await prisma.amazonMcpCredential.findUnique({ where: { tokenHash: hash(value) } }) : null;
  const grant = await prisma.liliOAuthGrant.findFirst({ where: { clientId, ...(refresh ? { id: refresh.grantId } : device ? { deviceId: device.id } : { id: "" }) } });
  if (!grant) return;
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', "lili-oauth:" + grant.id);
    await tx.liliOAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await tx.amazonMcpCredential.update({ where: { id: grant.deviceId }, data: { status: "REVOKED", revision: { increment: 1 } } });
  });
}

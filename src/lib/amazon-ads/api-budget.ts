import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { AdsSyncError } from "./sync-policy";

const leaseMs = 5 * 60_000;
export function adsClientIdHash(clientId: string) { return createHash("sha256").update(clientId).digest("hex"); }

export async function withAmazonAdsClientLease<T>(clientId: string, owner: string, operation: string, run: () => Promise<T>): Promise<T> {
  const clientIdHash = adsClientIdHash(clientId), now = new Date();
  try {
    await prisma.amazonAdsApiBudget.create({ data: { clientIdHash, nextRequestAt: now } });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
  }
  const before = await prisma.amazonAdsApiBudget.findUnique({ where: { clientIdHash }, select: { nextRequestAt: true, leaseExpiresAt: true } });
  const expiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await prisma.amazonAdsApiBudget.updateMany({
    where: { clientIdHash, nextRequestAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
    data: { leaseOwner: owner, leaseExpiresAt: expiresAt, operation },
  });
  if (!claimed.count) {
    const retryAt = Math.max(before?.nextRequestAt.getTime() ?? now.getTime(), before?.leaseExpiresAt?.getTime() ?? now.getTime());
    throw new AdsSyncError("ADS_CLIENT_RATE_LEASE_BUSY", true, Math.max(1000, retryAt - now.getTime()));
  }
  let retryAfterMs = 0;
  try {
    return await run();
  } catch (error) {
    if (error instanceof AdsSyncError) retryAfterMs = error.retryAfterMs;
    throw error;
  } finally {
    await prisma.amazonAdsApiBudget.updateMany({ where: { clientIdHash, leaseOwner: owner }, data: { leaseOwner: null, leaseExpiresAt: null, lastRequestAt: new Date(), nextRequestAt: new Date(Date.now() + Math.max(0, retryAfterMs)) } });
  }
}

import { AmazonAdsConnectionError, parseAmazonAdsProfiles, type AdsRegion, type AmazonAdsOAuthTransport } from "./oauth-contract";
import { AdsSyncError } from "./sync-policy";
import { validateAdsPage, type AdsReadAdapter } from "./sync-adapter";

type ProbeStage = "refresh" | "profiles" | "campaigns" | "ad-groups";
type ProbeProfile = { profileId: string; countryCode: string; marketplaceId: string | null; currencyCode: string | null; timezone: string | null };
export type AdsConnectionProbeResult = {
  status: "READ_COMPLETE" | "READ_PARTIAL" | "PROFILE_SELECTION_REQUIRED" | "BLOCKED";
  /** A protocol probe never publishes or persists facts, even when all pages fit. */
  persisted: false;
  apiRequests: number;
  profiles: ProbeProfile[];
  selectedProfileId: string | null;
  reads: Array<{ stage: "campaigns" | "ad-groups"; recordCount: number; externalIds: string[]; hasMore: boolean }>;
  failure?: { stage: ProbeStage; code: string; retryable: boolean; retryAfterMs: number };
};

/**
 * First-connection acceptance orchestrator, separate from the durable structure worker.
 * Explicit ports only: importing this module cannot access credentials, HTTP, DB or queues.
 * The caller must enforce its approved environment/account scope in authorize(), which is
 * rechecked before every request. No implicit retry, follow-up page or persistence occurs.
 */
export async function probeAmazonAdsConnection(
  input: { region: AdsRegion; profileId?: string; clientId: string; clientSecret: string; refreshToken: string; maxRequests: number },
  ports: {
    oauth: AmazonAdsOAuthTransport;
    structures: Pick<AdsReadAdapter, "readPage">;
    authorize: (operation: { stage: ProbeStage; region: AdsRegion; profileId: string | null }) => Promise<void>;
  },
): Promise<AdsConnectionProbeResult> {
  // Freeze caller-owned values before the first await.
  input = { ...input };
  ports = { ...ports };
  const result: AdsConnectionProbeResult = { status: "BLOCKED", persisted: false, apiRequests: 0, profiles: [], selectedProfileId: null, reads: [] };
  if (!["NA", "EU", "FE"].includes(input.region) || !Number.isSafeInteger(input.maxRequests) || input.maxRequests < 1 || input.maxRequests > 4
    || (input.profileId !== undefined && !/^\d{1,30}$/.test(input.profileId))
    || [input.clientId, input.clientSecret, input.refreshToken].some(value => typeof value !== "string" || !value.trim() || /[\r\n\u0000]/.test(value))) {
    throw new AdsSyncError("ADS_CONNECTION_PROBE_INPUT_INVALID");
  }
  let stage: ProbeStage = "refresh";
  const authorizeRequest = async () => {
    if (result.apiRequests >= input.maxRequests) throw new AdsSyncError("ADS_CONNECTION_PROBE_BUDGET_EXHAUSTED");
    await ports.authorize({ stage, region: input.region, profileId: result.selectedProfileId });
    // Charge before dispatch, including an HTTP failure or uncertain result.
    result.apiRequests++;
  };
  try {
    await authorizeRequest();
    const accessToken = await ports.oauth.refreshAccessToken({ region: input.region, clientId: input.clientId, clientSecret: input.clientSecret, refreshToken: input.refreshToken });
    stage = "profiles";
    await authorizeRequest();
    const profiles = parseAmazonAdsProfiles(await ports.oauth.listProfiles({ region: input.region, clientId: input.clientId, accessToken }));
    result.profiles = profiles.map(profile => ({ profileId: String(profile.profileId), countryCode: profile.countryCode,
      marketplaceId: profile.accountInfo?.marketplaceStringId ?? null, currencyCode: profile.currencyCode ?? null, timezone: profile.timezone ?? null }));
    if (input.profileId !== undefined && !result.profiles.some(profile => profile.profileId === input.profileId)) throw new AdsSyncError("ADS_CONNECTION_PROBE_PROFILE_NOT_DISCOVERED");
    if (!result.profiles.length) throw new AdsSyncError("ADS_CONNECTION_PROBE_NO_PROFILES");
    if (input.profileId === undefined && result.profiles.length !== 1) {
      result.status = "PROFILE_SELECTION_REQUIRED";
      return result;
    }
    result.selectedProfileId = input.profileId ?? result.profiles[0].profileId;
    for (const structure of ["campaigns", "ad-groups"] as const) {
      stage = structure;
      await authorizeRequest();
      const page = validateAdsPage(await ports.structures.readPage({ stage: structure, cursor: null, profileId: result.selectedProfileId,
        region: input.region, accessToken, clientId: input.clientId }), null);
      const expectedType = structure === "campaigns" ? "SP:campaign" : "SP:ad-group";
      if (page.reportFacts?.length || page.entities.some(entity => entity.entityType !== expectedType)) throw new AdsSyncError("ADS_CONNECTION_PROBE_ENTITY_TYPE_INVALID");
      result.reads.push({ stage: structure, recordCount: page.entities.length, externalIds: page.entities.map(entity => entity.externalId), hasMore: page.nextCursor !== null });
    }
    result.status = result.reads.some(read => read.hasMore) ? "READ_PARTIAL" : "READ_COMPLETE";
  } catch (error) {
    // Unknown errors may contain credentials or signed URLs. Return only fixed diagnostics.
    const known = error instanceof AdsSyncError;
    result.failure = { stage, code: known ? error.code : "ADS_CONNECTION_PROBE_FAILED", retryable: known ? error.retryable : false,
      retryAfterMs: error instanceof AmazonAdsConnectionError ? error.retryAfterMs : 0 };
  }
  return result;
}

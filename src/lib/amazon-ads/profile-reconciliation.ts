export interface AdsProfileIdentity {
  id: string;
  region: string;
  profileId: string;
}

export function missingAmazonAdsProfileIds(existing: readonly AdsProfileIdentity[], discovered: readonly AdsProfileIdentity[], successfulRegions: readonly string[]) {
  const discoveredKeys = new Set(discovered.map((profile) => `${profile.region}:${profile.profileId}`));
  const checkedRegions = new Set(successfulRegions);
  return existing.filter((profile) => checkedRegions.has(profile.region) && !discoveredKeys.has(`${profile.region}:${profile.profileId}`)).map((profile) => profile.id);
}

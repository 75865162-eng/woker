"use client";

import { aiSettingsStorageKey, aiImageSettingsStorageKey, aiSettingsProfilesStorageKey, type AiModelSettings, type SavedAiModelProfile } from "@/lib/ai-settings";
import { type SellerSpriteMcpPublicSettings, type SellerSpriteMcpSettings } from "@/lib/integrations/sellersprite";

export const fieldClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";

export const labelClass = "text-xs font-bold uppercase tracking-normal text-muted";

export const imageGenerationModelPattern = /(image|seedream|dall|imagen|flux)/i;

export type SellerSpriteMcpState = SellerSpriteMcpSettings & Pick<SellerSpriteMcpPublicSettings, "hasApiKey" | "configured">;

export function cacheAiSettings(settings: AiModelSettings, profiles: SavedAiModelProfile[]) {
  window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(settings));
  window.localStorage.setItem(aiSettingsProfilesStorageKey, JSON.stringify(profiles));
}

export function cacheAiImageSettings(settings: AiModelSettings) {
  window.localStorage.setItem(aiImageSettingsStorageKey, JSON.stringify(settings));
}

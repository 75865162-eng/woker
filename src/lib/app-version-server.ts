import "server-only";

import fs from "node:fs";
import path from "node:path";
import { defaultAppVersionLabel, normalizeAppVersionLabel } from "@/lib/app-version";

type ReleaseMetadata = {
  appVersion?: unknown;
};

function getReleaseMetadataPath() {
  return process.env.APP_RELEASE_METADATA_PATH ?? path.join(process.env.CURRENT_LINK ?? "/opt/amazon-ad-bulk-current", "RELEASE.json");
}

export function getCurrentAppVersionLabel() {
  try {
    const raw = fs.readFileSync(getReleaseMetadataPath(), "utf8");
    const metadata = JSON.parse(raw) as ReleaseMetadata;
    return normalizeAppVersionLabel(metadata.appVersion);
  } catch {
    return defaultAppVersionLabel;
  }
}

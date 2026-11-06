import { pathToFileURL } from "node:url";
import { runtimeEnvironment } from "./runtime/environment.mjs";

// Configuration inspection only: never connects, decrypts or invokes Amazon.
export function inspectLiveConfiguration(environment) {
  const loopback = value => {
    try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname); } catch { return false; }
  };
  let scopes;
  try { scopes = JSON.parse(environment.AMAZON_SYNC_CENTER_SCOPES ?? "null"); } catch { scopes = null; }
  const checks = {
    databaseConfigured: Boolean(environment.DATABASE_URL),
    databaseLoopback: loopback(environment.DATABASE_URL),
    redisConfigured: Boolean(environment.REDIS_URL),
    redisLoopback: loopback(environment.REDIS_URL),
    redisDriver: environment.QUEUE_DRIVER === "redis",
    encryptionKeyValid: /^[A-Za-z0-9+/]{43}=$/.test(environment.AMAZON_SP_API_ENCRYPTION_KEY ?? "") && Buffer.from(environment.AMAZON_SP_API_ENCRYPTION_KEY, "base64").length === 32,
    singleExplicitScope: Array.isArray(scopes) && scopes.length === 1 && Array.isArray(scopes[0]) && scopes[0].length === 2 && scopes[0].every(v => typeof v === "string" && v.trim() && v !== "*"),
    conservativeConcurrency: environment.AMAZON_SYNC_WORKER_CONCURRENCY === undefined || environment.AMAZON_SYNC_WORKER_CONCURRENCY === "1",
    authenticationConfigured: Boolean(environment.AUTH_SECRET),
    notProductionMode: environment.NODE_ENV !== "production" && environment.ERP_RUNTIME_MODE !== "production",
  };
  return { checks, configurationReady: Object.values(checks).every(Boolean), connectedToServices: false, amazonRequests: 0,
    requiresOperatorConfirmation: ["Dedicated local database and Redis, not a production tunnel or test fixture database", "Authorized real Seller and Marketplace configured through local UI", "Migrations applied, valid local account/workspace, old and new schedules disabled", "No fetch mocks or test harness in web/worker processes"],
    acceptance: "NOT_RUN: configuration inspection is not real Amazon acceptance" };
}
// Injectable root/environment lets fixtures exercise the real loader without reading private files.
export function inspectRuntimeConfiguration(options) {
  try {
    return inspectLiveConfiguration(runtimeEnvironment(options));
  } catch {
    // Loader errors may mention configuration keys. Keep CLI output a fixed, value-free report.
    return { configurationReady: false, configurationLoadFailed: true, connectedToServices: false, amazonRequests: 0,
      acceptance: "NOT_RUN: unified runtime configuration rejected; review root .env and inherited environment" };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = inspectRuntimeConfiguration();
  console.log(JSON.stringify(report, null, 2));
  if (!report.configurationReady) process.exitCode = 2;
}

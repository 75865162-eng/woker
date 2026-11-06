import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Values are literal (including $); Next and Workers receive the same parsed map.
/**
 * @param {{root?: string, inherited?: Record<string, string | undefined>, build?: boolean, validation?: "runtime" | "database" | "schema"}} [options]
 * @returns {Record<string, string | undefined>}
 */
export function runtimeEnvironment({ root = projectRoot, inherited = process.env, build = false, validation = "runtime" } = {}) {
  if (!["runtime", "database", "schema"].includes(validation)) throw new Error("Unknown runtime validation mode");
  if (inherited.ERP_LOCAL_INTEGRATION_PROFILE !== undefined) {
    throw new Error("Temporary integration profiles are retired. Use the approved root .env configuration.");
  }
  const mode = inherited.ERP_RUNTIME_MODE ?? "local";
  if (!["local", "production"].includes(mode)) throw new Error("ERP_RUNTIME_MODE must be local or production");
  if (inherited.DOTENV_CONFIG_PATH && path.resolve(root, inherited.DOTENV_CONFIG_PATH) !== path.join(root, ".env")) {
    throw new Error("Alternate dotenv files are disabled. Migrate approved variables to root .env first.");
  }
  let configured = {};
  if (mode === "local") {
    const extra = readdirSync(root).filter(name => /^\.env\.(local|development|production|test)(\.local)?$/.test(name));
    if (extra.length) throw new Error(`Extra Next environment files must be reviewed before startup: ${extra.join(", ")}`);
    const filename = path.join(root, ".env");
    if (!existsSync(filename) && !build && validation !== "schema") throw new Error("Root .env is required; use .env.example after reviewing the target database.");
    if (existsSync(filename)) configured = parseEnv(readFileSync(filename, "utf8"));
    for (const [key, value] of Object.entries(configured)) {
      if (inherited[key] !== undefined && inherited[key] !== value) throw new Error(`Inherited ${key} conflicts with root .env; refusing mixed configuration.`);
    }
  }
  const env = { ...inherited, ...configured, ERP_RUNTIME_MODE: mode };
  // Never let dotenv or Next subsequently select a second environment source.
  delete env.DOTENV_CONFIG_PATH;
  env.__NEXT_PROCESSED_ENV = "true";
  if (!build || validation !== "runtime") {
    for (const key of validation === "runtime" ? ["DATABASE_URL", "REDIS_URL"] : ["DATABASE_URL"]) {
      if (validation === "schema" && !env[key]) continue;
      let url;
      try { url = new URL(env[key]); } catch { throw new Error(`${key} must be configured with a valid URL`); }
      if (!(key === "DATABASE_URL" ? ["postgres:", "postgresql:"] : ["redis:", "rediss:"]).includes(url.protocol)) throw new Error(`${key} has an invalid protocol`);
      if (mode === "local" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error(`Local ${key} must use loopback; remote databases are forbidden.`);
    }
    if (validation === "runtime" && env.QUEUE_DRIVER !== "redis") throw new Error("ERP runtime requires QUEUE_DRIVER=redis so web and Workers use the same durable workflow.");
  }
  return env;
}

export function applyRuntimeEnvironment(options) {
  const env = runtimeEnvironment(options);
  delete process.env.DOTENV_CONFIG_PATH;
  Object.assign(process.env, env);
  return env;
}

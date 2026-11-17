export const sessionCookieName = "amazon_bulk_ad_session";

export const sessionMaxAgeSeconds = 60 * 60 * 12;

export const publicRoutes = ["/login"];

// /api/health is an unauthenticated liveness probe; it returns only {status:"ok"}.
export const publicApiPrefixes = ["/api/auth/login", "/api/auth/register", "/api/health"];

export type AuthDriver = "local" | "database";

export function getAuthDriver(): AuthDriver {
  const configuredDriver = process.env.AUTH_DRIVER;
  if (process.env.NODE_ENV === "production" && configuredDriver !== "database") {
    throw new Error("AUTH_DRIVER=database is required in production.");
  }

  return configuredDriver === "database" ? "database" : "local";
}

export function getBootstrapAdminEmail() {
  const configured = process.env.BOOTSTRAP_ADMIN_EMAIL;
  // "1" is a local-development convenience. Never let an unconfigured
  // production host silently treat that literal as the owner account.
  if (process.env.NODE_ENV === "production" && !configured?.trim()) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL is required in production.");
  }
  return (configured || "1").trim().toLowerCase();
}

export function isBootstrapAdminEmail(email?: string | null) {
  return (email ?? "").trim().toLowerCase() === getBootstrapAdminEmail();
}

const PLACEHOLDER_AUTH_SECRETS = new Set([
  "local-development-auth-secret",
  "change-this-local-secret-before-production",
  "replace-with-a-random-secret-at-least-32-characters",
]);

/** Single source of truth for session signing (Node) and middleware verification (Edge). */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || PLACEHOLDER_AUTH_SECRETS.has(secret) || secret.length < 32) {
    throw new Error("AUTH_SECRET must be explicitly configured with a non-placeholder value of at least 32 characters.");
  }

  return secret;
}

export function getBootstrapAdminPassword() {
  const configured = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < 10 || configured === "replace-with-a-strong-password")) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be a real password with at least 10 characters in production.");
  }
  return configured || "1"; // dev-only convenience; production throws above
}

export function getBootstrapOrganizationName() {
  return process.env.BOOTSTRAP_ORG_NAME || "Local Organization";
}

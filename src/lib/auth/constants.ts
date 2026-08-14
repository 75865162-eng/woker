export const sessionCookieName = "amazon_bulk_ad_session";

export const sessionMaxAgeSeconds = 60 * 60 * 12;

export const publicRoutes = ["/login"];

export const publicApiPrefixes = ["/api/auth/login", "/api/auth/register"];

export type AuthDriver = "local" | "database";

export function getAuthDriver(): AuthDriver {
  return process.env.AUTH_DRIVER === "database" ? "database" : "local";
}

export function getBootstrapAdminEmail() {
  return (process.env.BOOTSTRAP_ADMIN_EMAIL || "1").trim().toLowerCase();
}

export function isBootstrapAdminEmail(email?: string | null) {
  return Boolean(email && email.trim().toLowerCase() === getBootstrapAdminEmail());
}

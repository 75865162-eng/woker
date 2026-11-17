export const sessionCookieName = "amazon_bulk_ad_session";

export const sessionMaxAgeSeconds = 60 * 60 * 12;

export const publicRoutes = ["/login"];

export const publicApiPrefixes = ["/api/auth/login", "/api/auth/register"];

export type AuthDriver = "local" | "database";

export function getAuthDriver(): AuthDriver {
  const configuredDriver = process.env.AUTH_DRIVER;
  if (process.env.NODE_ENV === "production" && configuredDriver !== "database") {
    throw new Error("AUTH_DRIVER=database is required in production.");
  }

  return configuredDriver === "database" ? "database" : "local";
}

export function getBootstrapAdminEmail() {
  return (process.env.BOOTSTRAP_ADMIN_EMAIL || "1").trim().toLowerCase();
}

export function isBootstrapAdminEmail(email?: string | null) {
  return (email ?? "").trim().toLowerCase() === getBootstrapAdminEmail();
}

/**
 * 注意：下面的 BOOTSTRAP_ADMIN_* 默认值 "1" 仅供 local auth driver 的本地开发登录使用。
 * 生产环境由 getAuthDriver() 强制 AUTH_DRIVER=database，local 登录路径不生效，因此这些默认值不会暴露到生产。
 * 部署自检可调用 assertProductionBootstrapCredentials() 提前发现误配。
 */
export function getBootstrapAdminPassword() {
  return process.env.BOOTSTRAP_ADMIN_PASSWORD || "1";
}

/** 生产自检：local driver 专用默认凭据不应被带入生产配置。返回问题清单，空数组表示通过。 */
export function getProductionBootstrapWarnings(): string[] {
  if (process.env.NODE_ENV !== "production") return [];
  const warnings: string[] = [];
  if (!process.env.BOOTSTRAP_ADMIN_EMAIL || getBootstrapAdminEmail() === "1") {
    warnings.push("BOOTSTRAP_ADMIN_EMAIL 未配置为非默认值。");
  }
  if (!process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD === "1") {
    warnings.push("BOOTSTRAP_ADMIN_PASSWORD 未配置为非默认值。");
  }
  return warnings;
}

export function getBootstrapOrganizationName() {
  return process.env.BOOTSTRAP_ORG_NAME || "Local Organization";
}

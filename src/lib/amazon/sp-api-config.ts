const requiredEnvironmentVariables = [
  "AMAZON_SP_API_LWA_CLIENT_ID",
  "AMAZON_SP_API_LWA_CLIENT_SECRET",
  "AMAZON_SP_API_REFRESH_TOKEN",
  "AMAZON_SP_API_AWS_ACCESS_KEY_ID",
  "AMAZON_SP_API_AWS_SECRET_ACCESS_KEY",
] as const;

export type AmazonSpApiConfigurationStatus = {
  configured: boolean;
  missingEnvironmentVariables: string[];
  region: string;
};

export type AmazonSpApiServerConfiguration = {
  lwaClientId: string;
  lwaClientSecret: string;
  refreshToken: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken?: string;
  region: string;
  endpoint: string;
};

export type AmazonSpApiAllowedScope = {
  organizationId: string;
  workspaceId: string;
};

export function getAmazonSpApiConfigurationStatus(environment: Record<string, string | undefined> = process.env): AmazonSpApiConfigurationStatus {
  const missingEnvironmentVariables = requiredEnvironmentVariables.filter((key) => !environment[key]?.trim());

  return {
    configured: missingEnvironmentVariables.length === 0,
    missingEnvironmentVariables,
    region: environment.AMAZON_SP_API_AWS_REGION?.trim() || "us-east-1",
  };
}

/**
 * Server-only credentials. Callers must never serialize this object or expose it to a route response.
 */
export function getAmazonSpApiServerConfiguration(
  environment: Record<string, string | undefined> = process.env,
): AmazonSpApiServerConfiguration {
  const status = getAmazonSpApiConfigurationStatus(environment);
  if (!status.configured) {
    throw new Error(`服务端缺少 SP-API 配置：${status.missingEnvironmentVariables.join("、")}`);
  }

  const endpoint = environment.AMAZON_SP_API_ENDPOINT?.trim() || "https://sellingpartnerapi-na.amazon.com";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("AMAZON_SP_API_ENDPOINT 必须是有效的 HTTPS 地址。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("AMAZON_SP_API_ENDPOINT 必须是无路径、无凭据的 HTTPS 服务地址。");
  }

  return {
    lwaClientId: environment.AMAZON_SP_API_LWA_CLIENT_ID!.trim(),
    lwaClientSecret: environment.AMAZON_SP_API_LWA_CLIENT_SECRET!.trim(),
    refreshToken: environment.AMAZON_SP_API_REFRESH_TOKEN!.trim(),
    awsAccessKeyId: environment.AMAZON_SP_API_AWS_ACCESS_KEY_ID!.trim(),
    awsSecretAccessKey: environment.AMAZON_SP_API_AWS_SECRET_ACCESS_KEY!.trim(),
    awsSessionToken: environment.AMAZON_SP_API_AWS_SESSION_TOKEN?.trim() || undefined,
    region: status.region,
    endpoint: url.origin,
  };
}

/**
 * Process environment credentials are intentionally bound to one tenant scope until a tenant-aware secret vault is introduced.
 */
export function assertAmazonSpApiScopeAllowed(
  scope: AmazonSpApiAllowedScope,
  environment: Record<string, string | undefined> = process.env,
) {
  const organizationId = environment.AMAZON_SP_API_ALLOWED_ORGANIZATION_ID?.trim();
  const workspaceId = environment.AMAZON_SP_API_ALLOWED_WORKSPACE_ID?.trim();
  if (!organizationId || !workspaceId) {
    throw new Error("启用 Amazon 连接校验前，必须配置 AMAZON_SP_API_ALLOWED_ORGANIZATION_ID 和 AMAZON_SP_API_ALLOWED_WORKSPACE_ID。" );
  }
  if (scope.organizationId !== organizationId || scope.workspaceId !== workspaceId) {
    throw new Error("当前组织或工作区未获准使用此 Amazon SP-API 服务端连接。" );
  }
}

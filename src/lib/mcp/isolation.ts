/**
 * Provider-level isolation for the external MCP servers.
 *
 * Two servers are exposed by this ERP:
 *  - Amazon   `/api/mcp/amazon`  token prefix `amcp_`   credential: AmazonMcpCredential
 *  - Sellfox  `/api/mcp/sellfox` token prefix `sfmcp_`  credential: SellfoxMcpCredential
 *
 * Isolation is enforced in four independent layers:
 *  1. transport  - a token only parses for the provider that issued its prefix.
 *  2. endpoint   - a credential presented to the other provider's endpoint is
 *                  rejected before any database lookup, and audited.
 *  3. catalog    - tool names and dataset/table names are closed allow-lists;
 *                  every tool is namespaced with its provider.
 *  4. storage    - each provider reads through its own read-only Postgres role
 *                  (mcp_amazon_ro / mcp_sellfox_ro) and its own table prefix.
 *
 * This module is pure: no database, no environment, safe to import from the UI.
 */

export type McpProvider = "amazon" | "sellfox";

export type McpProviderPolicy = {
  provider: McpProvider;
  label: string;
  tokenPrefix: string;
  audiencePath: string;
  serverName: string;
  credentialModel: string;
  /** Prefix of every table the provider is allowed to read. */
  tablePrefix: string;
  /** Every tool name must start with this namespace. */
  toolNamespace: string;
  /** Names that belong to the other provider; rejected on sight. */
  foreignDatasetMarkers: readonly string[];
  dbRole: string;
  dbRoleEnv: string;
  readonlyRoleEnv: string;
  auditPrefix: string;
};

export const mcpProviderPolicies: Record<McpProvider, McpProviderPolicy> = {
  amazon: {
    provider: "amazon",
    label: "Amazon MCP",
    tokenPrefix: "amcp_",
    audiencePath: "/api/mcp/amazon",
    serverName: "erp-amazon",
    credentialModel: "AmazonMcpCredential",
    tablePrefix: "Amazon",
    toolNamespace: "amazon.",
    foreignDatasetMarkers: ["sellfox", "Sellfox"],
    dbRole: "mcp_amazon_ro",
    dbRoleEnv: "AMAZON_MCP_PG_READONLY_URL",
    readonlyRoleEnv: "AMAZON_MCP_READONLY",
    auditPrefix: "amazon.mcp",
  },
  sellfox: {
    provider: "sellfox",
    label: "赛狐 MCP",
    tokenPrefix: "sfmcp_",
    audiencePath: "/api/mcp/sellfox",
    serverName: "erp-sellfox",
    credentialModel: "SellfoxMcpCredential",
    tablePrefix: "Sellfox",
    toolNamespace: "sellfox.",
    foreignDatasetMarkers: ["amazon", "Amazon", "ads_report_daily", "ads_entities", "Lili"],
    dbRole: "mcp_sellfox_ro",
    dbRoleEnv: "MCP_PG_READONLY_URL",
    readonlyRoleEnv: "SELLFOX_MCP_READONLY",
    auditPrefix: "sellfox.mcp",
  },
};

export const mcpProviders = Object.keys(mcpProviderPolicies) as McpProvider[];

export type McpIsolationCode =
  | "PROVIDER_MISMATCH"
  | "UNKNOWN_TOKEN_PREFIX"
  | "DATASET_NOT_ALLOWED"
  | "TABLE_NOT_ALLOWED"
  | "STORE_NOT_ALLOWED"
  | "TOOL_NOT_ALLOWED";

export class McpIsolationError extends Error {
  constructor(
    message: string,
    readonly code: McpIsolationCode,
    readonly status = 403,
    readonly provider?: McpProvider,
  ) {
    super(message);
    this.name = "McpIsolationError";
  }
}

export function mcpAuditAction(provider: McpProvider, event: string) {
  return `${mcpProviderPolicies[provider].auditPrefix}.${event}`;
}

/** Extract a bearer token without deciding which provider it belongs to. */
export function bearerToken(authorization: string | null | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(\S{8,200})$/);
  return match?.[1] ?? null;
}

export function providerOfToken(token: string | null): McpProvider | null {
  if (!token) return null;
  for (const provider of mcpProviders) if (token.startsWith(mcpProviderPolicies[provider].tokenPrefix)) return provider;
  return null;
}

/** Reject a credential issued by the other provider before touching storage. */
export function assertEndpointProvider(endpoint: McpProvider, credentialProvider: McpProvider | null) {
  if (credentialProvider === endpoint) return;
  if (credentialProvider === null) {
    throw new McpIsolationError(
      "认证失败：凭证前缀不属于任何 MCP 服务。",
      "UNKNOWN_TOKEN_PREFIX",
      401,
      endpoint,
    );
  }
  throw new McpIsolationError(
    `凭证与端点不匹配：${mcpProviderPolicies[credentialProvider].label} 凭证不能访问 ${mcpProviderPolicies[endpoint].label}。`,
    "PROVIDER_MISMATCH",
    401,
    endpoint,
  );
}

/** Table names are static per provider; never accept a name from the caller. */
export function assertProviderTable(provider: McpProvider, table: string, allowList: readonly string[]) {
  const policy = mcpProviderPolicies[provider];
  if (!allowList.includes(table) || !table.startsWith(policy.tablePrefix)) {
    throw new McpIsolationError(`数据表不属于 ${policy.label} 的封闭清单。`, "TABLE_NOT_ALLOWED", 403, provider);
  }
  if (policy.foreignDatasetMarkers.some(marker => table.includes(marker))) {
    throw new McpIsolationError(`数据表属于其他数据源，禁止跨源读取。`, "TABLE_NOT_ALLOWED", 403, provider);
  }
}

/** Datasets are a closed allow-list per provider and are namespace checked. */
export function assertProviderDataset(provider: McpProvider, dataset: string, allowList: readonly string[]) {
  const policy = mcpProviderPolicies[provider];
  if (!allowList.includes(dataset)) {
    throw new McpIsolationError(`数据集「${dataset}」不在 ${policy.label} 的授权清单内。`, "DATASET_NOT_ALLOWED", 403, provider);
  }
  if (policy.foreignDatasetMarkers.some(marker => dataset.includes(marker))) {
    throw new McpIsolationError("数据集属于其他数据源，禁止跨源读取。", "DATASET_NOT_ALLOWED", 403, provider);
  }
}

/** Credential store scope is an intersection, never a union with request input. */
export function assertCredentialStores(provider: McpProvider, allowed: readonly string[], requested: readonly string[]) {
  if (!requested.length) return;
  if (allowed.includes("*")) return;
  const denied = requested.filter(id => !allowed.includes(id));
  if (denied.length) {
    throw new McpIsolationError(`店铺 ${denied.slice(0, 3).join(", ")} 不在该凭证的店铺范围内。`, "STORE_NOT_ALLOWED", 403, provider);
  }
}

export function assertCredentialTool(provider: McpProvider, allowed: readonly string[], tool: string) {
  if (allowed.includes(tool)) return;
  throw new McpIsolationError(`工具「${tool}」未授权给该凭证。`, "TOOL_NOT_ALLOWED", 403, provider);
}

export type McpIsolationMatrixRow = {
  provider: McpProvider;
  label: string;
  endpoint: string;
  tokenPrefix: string;
  credentialModel: string;
  tablePrefix: string;
  dbRole: string;
  dbRoleConfigured: boolean;
  auditPrefix: string;
  crossProviderPolicy: string;
};

/** Redacted, server-safe matrix used by the settings UI. */
export function mcpIsolationMatrix(environment: Record<string, string | undefined> = {}): McpIsolationMatrixRow[] {
  return mcpProviders.map(provider => {
    const policy = mcpProviderPolicies[provider];
    return {
      provider,
      label: policy.label,
      endpoint: policy.audiencePath,
      tokenPrefix: policy.tokenPrefix,
      credentialModel: policy.credentialModel,
      tablePrefix: `${policy.tablePrefix}*`,
      dbRole: policy.dbRole,
      dbRoleConfigured: Boolean(environment[policy.dbRoleEnv]?.trim()),
      auditPrefix: policy.auditPrefix,
      crossProviderPolicy: "拒绝并记录",
    };
  });
}

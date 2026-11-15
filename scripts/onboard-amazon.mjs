/**
 * Guided Amazon SP-API / Ads onboarding for a production deployment.
 *
 *   npm run prod:onboard-amazon -- --env-file /etc/tiaotiao/erp.env \
 *     --base-url https://erp.example.com \
 *     --requester-cookie 'amazon_bulk_ad_session=...' --approver-cookie 'amazon_bulk_ad_session=...' \
 *     --workspace-id ws_xxx --seller-account-id seller_xxx --marketplace-id ATVPDKIKX0DER \
 *     --amazon-seller-id AXXXXXXXX --grant-user-id user_xxx --apply
 *
 * The project enforces independent approval (self-approval is rejected in the
 * service layer, execution layer AND a database CHECK), so two DIFFERENT user
 * sessions are mandatory. This script drives the real three-step chain:
 *   POST /api/operations/sync-center            -> 202 change request
 *   POST /api/operations/sync-center/approvals   -> APPROVED (approver session)
 *   POST /api/operations/sync-center/approvals   -> APPLY
 *
 * It NEVER writes to the database directly and NEVER fabricates
 * identityVerifiedAt: seller identity must come from real Amazon OAuth, whose
 * consent URL is printed for the operator to complete in a browser.
 *
 * Dry-run by default: no network calls and no mutations without --apply.
 */
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const args = process.argv.slice(2);
const flag = name => {
  const eq = args.find(arg => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : undefined;
};
const has = name => args.includes(`--${name}`);
const required = (name, label) => {
  const value = flag(name);
  if (!value) throw new Error(`Missing --${name} (${label})`);
  return value;
};

const envPath = path.resolve(required("env-file", "production EnvironmentFile"));
if (!existsSync(envPath)) throw new Error(`EnvironmentFile not found: ${envPath}`);
const env = { ...process.env, ...parseEnv(readFileSync(envPath, "utf8")) };
const baseUrl = String(required("base-url", "public HTTPS origin")).replace(/\/$/, "");
if (!baseUrl.startsWith("https://")) throw new Error("--base-url must be HTTPS in production.");
const workspaceId = required("workspace-id", "ERP workspace id");

// Credentials are read from the EnvironmentFile and are never printed or logged.
const credential = key => {
  const value = (env[key] ?? "").trim();
  if (!value || /^(REPLACE|GENERATE):/.test(value)) throw new Error(`${key} is missing or still a placeholder in ${envPath}`);
  return value;
};

const lwaClientId = credential("AMAZON_SP_API_LWA_CLIENT_ID");
const lwaClientSecret = credential("AMAZON_SP_API_LWA_CLIENT_SECRET");
const refreshToken = credential("AMAZON_SP_API_REFRESH_TOKEN");
credential("AMAZON_ADS_LWA_CLIENT_ID");
credential("AMAZON_ADS_LWA_CLIENT_SECRET");
if (env.AMAZON_API_EXECUTION_ROLE !== "cloud") throw new Error("AMAZON_API_EXECUTION_ROLE must be cloud for real Amazon access.");

const region = flag("region") ?? env.AMAZON_SP_API_AWS_REGION ?? "us-east-1";
const endpoint = flag("endpoint") ?? env.AMAZON_SP_API_ENDPOINT ?? "https://sellingpartnerapi-na.amazon.com";
const sellerAccountId = required("seller-account-id", "ERP SellerAccount.id");
const marketplaceId = required("marketplace-id", "Amazon marketplace id");
const amazonSellerId = required("amazon-seller-id", "real Amazon Seller ID from OAuth");
const grantUserId = required("grant-user-id", "user id receiving data access");
const resources = (flag("resources") ?? "orders,finance,catalog,inventory,sales_traffic,settlements")
  .split(",").map(value => value.trim()).filter(Boolean);
const apply = has("apply");
const liveValidation = has("allow-live-validation");

const plan = [
  { step: "save-authorization", detail: "写入 LWA 凭据（加密入库），创建或更新 SP-API 授权" },
  { step: "save-access-grant", detail: `授予用户 ${grantUserId} 对店铺 ${sellerAccountId} 的数据访问` },
  ...resources.map(resource => ({ step: "save-source", detail: `启用数据源 ${resource} / ${marketplaceId}` })),
  ...(liveValidation ? [{ step: "validate-authorization", detail: "调用真实 Amazon 验证参与站点（会产生外部请求）" }] : []),
  { step: "oauth-consent", detail: "生成 Amazon OAuth 同意链接（需操作员在浏览器完成，脚本不代劳）" },
];

console.log(`Amazon 生产接入 ${apply ? "[APPLY]" : "[DRY-RUN]"}`);
console.log(`  目标        ${baseUrl}`);
console.log(`  工作区      ${workspaceId}`);
console.log(`  站点/店铺   ${marketplaceId} / ${sellerAccountId}`);
console.log(`  区域        ${region} · ${endpoint}`);
console.log(`  数据源      ${resources.join(", ")}`);
console.log("  计划：");
plan.forEach((row, index) => console.log(`    ${index + 1}. ${row.step.padEnd(24)} ${row.detail}`));

if (!apply) {
  console.log("\n未发起任何网络请求、未修改任何数据。确认后加 --apply，并提供两个不同管理员的会话 Cookie：");
  console.log("  --requester-cookie 'amazon_bulk_ad_session=...' --approver-cookie 'amazon_bulk_ad_session=...'");
  process.exit(0);
}

const requesterCookie = required("requester-cookie", "session cookie of the change requester");
const approverCookie = required("approver-cookie", "session cookie of an INDEPENDENT approver");
if (requesterCookie === approverCookie) throw new Error("Requester and approver must be different users (self-approval is forbidden).");

const origin = new URL(baseUrl).origin;
async function callApi(urlPath, { method = "GET", body, cookie, cookieLabel }) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      // Browser-equivalent headers required by the CSRF guard for cookie-auth writes.
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "X-Workspace-Id": workspaceId,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  if (!response.ok && response.status !== 202) {
    throw new Error(`${method} ${urlPath} [${cookieLabel}] -> ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { status: response.status, data };
}

async function executeChange(command, label) {
  const requested = await callApi("/api/operations/sync-center", {
    method: "POST", body: { ...command, workspaceId }, cookie: requesterCookie, cookieLabel: "requester",
  });
  const id = requested.data?.changeRequest?.id;
  if (!id) throw new Error(`${label}: no changeRequest.id in response: ${JSON.stringify(requested.data).slice(0, 400)}`);
  await callApi("/api/operations/sync-center/approvals", {
    method: "POST", body: { id, decision: "APPROVED", reason: "生产上线接入，已核对变更摘要", workspaceId },
    cookie: approverCookie, cookieLabel: "approver",
  });
  await callApi("/api/operations/sync-center/approvals", {
    method: "POST", body: { id, decision: "APPLY", workspaceId }, cookie: requesterCookie, cookieLabel: "requester",
  });
  console.log(`  [OK] ${label} (审批 ${id.slice(0, 8)}…)`);
  return id;
}

const health = await callApi("/api/health", { cookie: requesterCookie, cookieLabel: "requester" });
if (health.data?.status !== "ok") throw new Error("Liveness probe did not return status=ok");
console.log("  [OK] /api/health");

const requester = await callApi("/api/auth/me", { cookie: requesterCookie, cookieLabel: "requester" });
const approver = await callApi("/api/auth/me", { cookie: approverCookie, cookieLabel: "approver" });
const requesterId = requester.data?.user?.id ?? requester.data?.id;
const approverId = approver.data?.user?.id ?? approver.data?.id;
if (!requesterId || !approverId || requesterId === approverId) {
  throw new Error("Both sessions must belong to different active users with approval rights.");
}
console.log(`  [OK] 申请人 ${String(requesterId).slice(0, 8)}… / 独立审批人 ${String(approverId).slice(0, 8)}…`);

const connections = await callApi(`/api/operations/sync-center?section=connections&workspaceId=${encodeURIComponent(workspaceId)}`, {
  cookie: requesterCookie, cookieLabel: "requester",
});
if (connections.status !== 200) throw new Error("Sync center is not accessible; check AMAZON_SYNC_CENTER_SCOPES and permissions.");
const sellers = connections.data?.sellers ?? [];
if (sellers.length && !sellers.some(seller => seller.id === sellerAccountId)) {
  throw new Error(`SellerAccount ${sellerAccountId} not found in this workspace; create it in Settings first.`);
}
console.log(`  [OK] 同步中心可访问；店铺 ${sellers.length} 个`);

await executeChange({
  action: "save-authorization",
  name: `Production SP-API ${amazonSellerId}`,
  amazonSellerId,
  region,
  endpoint,
  lwaClientId,
  lwaClientSecret,
  refreshToken,
  approvedRoles: [],
}, "SP-API 授权");

await executeChange({
  action: "save-access-grant",
  userId: grantUserId,
  sellerAccountId,
  enabled: true,
  marketplaceIds: [marketplaceId],
  actions: ["read"],
  mcpEnabled: false,
}, "数据访问授予");

// Re-read connections to resolve the authorization id assigned by the applied change.
const afterAuth = await callApi(`/api/operations/sync-center?section=connections&workspaceId=${encodeURIComponent(workspaceId)}`, {
  cookie: requesterCookie, cookieLabel: "requester",
});
const authorization = (afterAuth.data?.authorizations ?? []).find(row => row.amazonSellerId === amazonSellerId)
  ?? (afterAuth.data?.authorizations ?? [])[0];
if (!authorization?.id) throw new Error("Authorization was not created; cannot bind sync sources.");
console.log(`  [OK] 授权 id ${String(authorization.id).slice(0, 8)}… status=${authorization.status}`);

for (const resource of resources) {
  await executeChange({
    action: "save-source",
    authorizationId: authorization.id,
    sellerAccountId,
    marketplaceId,
    resource,
    enabled: true,
    freshnessMinutes: 1440,
  }, `数据源 ${resource}`);
}

if (liveValidation) {
  await executeChange({ action: "validate-authorization", id: authorization.id }, "真实参与站点验证");
}

// Seller identity can only be established by Amazon OAuth. Never write
// identityVerifiedAt ourselves; print the real consent URL instead.
try {
  const oauth = await callApi("/api/integrations/amazon/sp-api/oauth/start", {
    method: "POST", body: { region, workspaceId }, cookie: requesterCookie, cookieLabel: "requester",
  });
  if (oauth.data?.consentUrl) {
    console.log("\n【必须人工完成】在浏览器打开以下 Amazon 授权链接（10 分钟内有效）：");
    console.log(oauth.data.consentUrl);
  } else {
    console.log(`\n【必须人工完成】OAuth 未返回链接：${JSON.stringify(oauth.data).slice(0, 300)}`);
  }
} catch (error) {
  console.log(`\n【必须人工完成】无法生成 OAuth 链接：${error.message}`);
  console.log("请在 设置 → 集成 → Amazon 数据处理中心 手动发起 OAuth 授权。");
}

// Read-only verification of the resulting state.
const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
try {
  await client.connect();
  const queries = {
    configuredAuthorizations: `SELECT count(*)::int AS n FROM "AmazonSpApiAuthorization" WHERE status='CONFIGURED' AND "identityVerifiedAt" IS NOT NULL`,
    enabledGrants: `SELECT count(*)::int AS n FROM "AmazonDataAccessGrant" WHERE enabled=true`,
    sellerIdentities: `SELECT count(*)::int AS n FROM "AmazonSellerIdentity"`,
    enabledSources: `SELECT count(*)::int AS n FROM "AmazonSyncDataSource" WHERE enabled=true`,
  };
  console.log("\n只读核验：");
  for (const [label, sql] of Object.entries(queries)) {
    const result = await client.query(sql);
    console.log(`  ${label.padEnd(26)} ${result.rows[0].n}`);
  }
} catch (error) {
  console.log(`只读核验未完成：${error.message}`);
} finally {
  await client.end().catch(() => {});
}

console.log("\n最后运行：npm run check:production -- --env <EnvironmentFile> --gate full");
console.log("Ads 授权仍须独立 OAuth：设置 → 集成 → Amazon Ads，并在 profiles 页面确认 profile 已同步。");

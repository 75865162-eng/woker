#!/usr/bin/env node
/**
 * 凭证生命周期审计（Amazon SP-API / Ads）
 *
 * 对应《Amazon 数据域接入缺口清单》§9.10.2：
 *   - Refresh Token 年龄监控与到期前重授提醒（Ads 已有 refreshTokenExpiresAt；
 *     SP-API 以授权 createdAt 作为年度重授基准）；
 *   - LWA Client Secret 180 天轮换计划（签发日期由 EnvironmentFile 显式登记）。
 *
 * 只读：连接数据库执行 SELECT，不修改任何记录、不触发任何 Amazon 网络请求。
 * 用法：node scripts/credential-lifecycle-audit.mjs --env /opt/amazon-ad-bulk-operation/.env
 *      node scripts/credential-lifecycle-audit.mjs --env ... --json
 * 退出码：0=无过期项；1=存在 EXPIRED/OVERDUE；2=用法/连接错误。
 */

import { readFileSync } from "node:fs";
import { Client } from "pg";

const DAY = 86_400_000;

function parseArgs(argv) {
  const out = { env: null, json: false, warnDays: 60, spReauthDays: 365, secretRotateDays: 180, secretWarnDays: 150 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--env") out.env = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a.startsWith("--warn-days=")) out.warnDays = Number(a.split("=")[1]);
    else if (a.startsWith("--secret-warn-days=")) out.secretWarnDays = Number(a.split("=")[1]);
    else if (a.startsWith("--secret-rotate-days=")) out.secretRotateDays = Number(a.split("=")[1]);
    else if (a.startsWith("--sp-reauth-days=")) out.spReauthDays = Number(a.split("=")[1]);
    else if (a === "--help") {
      process.stdout.write("usage: credential-lifecycle-audit.mjs --env <EnvironmentFile> [--json] [--warn-days N] [--secret-warn-days N] [--secret-rotate-days N] [--sp-reauth-days N]\n");
      process.exit(0);
    } else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  if (!out.env) {
    process.stderr.write("--env <EnvironmentFile> 必填。\n");
    process.exit(2);
  }
  return out;
}

/** systemd EnvironmentFile 语义：KEY=VALUE，值中的空格原样保留，# 开头为注释。 */
function loadEnvironmentFile(path) {
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return env;
}

function daysUntil(date, now) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.round((date.getTime() - now.getTime()) / DAY);
}

function statusFromDays(days, warnDays, overdueDays) {
  if (days === null) return "UNKNOWN";
  if (days <= 0) return "EXPIRED";
  if (days <= warnDays) return "DUE";
  if (days > overdueDays) return "OVERDUE";
  return "OK";
}

function secretStatus(issuedAt, now, opts) {
  if (!issuedAt) return { status: "NOT_TRACKED", days: null, detail: "未登记签发日期（在 EnvironmentFile 设置 YYYY-MM-DD）" };
  const parsed = new Date(`${issuedAt}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { status: "UNKNOWN", days: null, detail: "签发日期格式无效，应为 YYYY-MM-DD" };
  // 签发日期按 YYYY-MM-DD 登记，允许与当前 UTC 日期相差一天（本地时区尚未跨日）。
  const age = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / DAY));
  if (age >= opts.secretRotateDays) return { status: "OVERDUE", days: age, detail: `已签发 ${age} 天，超过 ${opts.secretRotateDays} 天轮换期限` };
  if (age >= opts.secretWarnDays) return { status: "DUE", days: age, detail: `已签发 ${age} 天，计划轮换` };
  return { status: "OK", days: age, detail: `已签发 ${age} 天` };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = loadEnvironmentFile(opts.env);
  if (!env.DATABASE_URL) {
    process.stderr.write("EnvironmentFile 缺少 DATABASE_URL。\n");
    process.exit(2);
  }
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  const now = new Date();
  const items = [];
  try {
    const ads = await client.query(
      `SELECT "id", "organizationId", "workspaceId", "status", "refreshTokenExpiresAt", "createdAt"
       FROM "AmazonAdsAuthorization" WHERE "status" = 'CONNECTED' ORDER BY "refreshTokenExpiresAt" NULLS FIRST`
    );
    for (const row of ads.rows) {
      const days = daysUntil(row.refreshTokenExpiresAt, now);
      items.push({
        kind: "ads_refresh_token",
        scope: `${row.organizationId}/${row.workspaceId}/${row.id}`,
        status: statusFromDays(days, opts.warnDays, 365),
        days,
        detail: days === null ? "缺少 refreshTokenExpiresAt" : `剩余 ${days} 天（官方 365 天到期，需重走完整授权）`,
      });
    }

    const sp = await client.query(
      `SELECT "id", "organizationId", "workspaceId", "status", "createdAt", "lastValidatedAt"
       FROM "AmazonSpApiAuthorization" WHERE "status" = 'CONFIGURED' ORDER BY "createdAt"`
    );
    for (const row of sp.rows) {
      const age = Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / DAY);
      const status = age >= opts.spReauthDays ? "OVERDUE" : age >= opts.spReauthDays - opts.warnDays ? "DUE" : "OK";
      items.push({
        kind: "sp_refresh_token",
        scope: `${row.organizationId}/${row.workspaceId}/${row.id}`,
        status,
        days: age,
        detail: `授权已建立 ${age} 天；按年度重授策略在 ${opts.spReauthDays} 天前完成重授权`,
      });
    }

    for (const [kind, key] of [
      ["sp_client_secret", "AMAZON_LWA_CLIENT_SECRET_ISSUED_AT"],
      ["ads_client_secret", "AMAZON_ADS_LWA_CLIENT_SECRET_ISSUED_AT"],
    ]) {
      const result = secretStatus(env[key], now, opts);
      items.push({ kind, scope: key, ...result });
    }
  } finally {
    await client.end();
  }

  const counts = items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {});
  if (opts.json) {
    process.stdout.write(JSON.stringify({ generatedAt: now.toISOString(), counts, items }, null, 2) + "\n");
  } else {
    process.stdout.write(`凭证生命周期审计 ${now.toISOString()}  环境文件=${opts.env}\n`);
    process.stdout.write("状态          类型                     范围 / 详情\n");
    for (const item of items) {
      process.stdout.write(`${item.status.padEnd(14)}${item.kind.padEnd(24)}${item.scope} — ${item.detail}\n`);
    }
    process.stdout.write(`汇总：${JSON.stringify(counts)}\n`);
  }
  const blocking = (counts.EXPIRED ?? 0) + (counts.OVERDUE ?? 0);
  process.exit(blocking > 0 ? 1 : 0);
}

main().catch(err => {
  process.stderr.write(`审计失败：${err.message}\n`);
  process.exit(2);
});

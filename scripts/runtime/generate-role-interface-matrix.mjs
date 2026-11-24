#!/usr/bin/env node
/**
 * 生成「角色 × 接口」权限矩阵（可审计产物）。
 *
 * 静态解析全部 API 路由，递归解析 re-export 转发，识别每条路由：
 *   - 鉴权入口（requireApiPermission / 领域鉴权 / 自有 Bearer / 公开）
 *   - 模块 ID 与动作（view/create/edit）
 *   - 是否带工作区围栏（assertWorkspaceAccess / workspaceScopeFromRequest）
 *
 * 输出 docs/security/role-interface-matrix.json 与 .md。
 * 本脚本只做静态分析，不执行路由、不连接数据库。
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const API = path.join(ROOT, "src/app/api");
const OUT_DIR = path.join(ROOT, "docs/security");

const AUTH_KINDS = [
  { id: "apiPermission", re: /requireApiPermission\(/ },
  { id: "pointsAccess", re: /getPointsAccessContext\(/ },
  { id: "wmsAccess", re: /wmsRequestScope\(|requireWms\w*\(/ },
  { id: "accessView", re: /requireAccessView\(/ },
  { id: "accessEdit", re: /requireAccessEdit\(/ },
  { id: "amazonRead", re: /requireAmazonReadSession\(|assertAmazonAction\(/ },
  { id: "researchAccess", re: /researchAccess\(|researchRequestAuthorization\(/ },
  { id: "mcpBearer", re: /authenticateSellfoxMcp\(|validateAmazonMcpCredential\(|verifyCloudRelayEnvelope\(/ },
  { id: "liliOAuth", re: /verifyLili\w*Token\(|exchangePairing\(|handleLiliRequest\(|authorizeLili\(|exchangeLiliToken\(/ },
  { id: "sessionUser", re: /getCurrentUserFromRequest\(/ },
  { id: "workspacesAccess", re: /requireWorkspaceOwner\(|manageWorkspaceMembership\(/ },
  { id: "authEndpoint", re: /createSession\(|destroyCurrentSession\(|hashPassword\(/ },
  { id: "publicHealth", re: /publicApiPrefixes|observability|web-vitals/i },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

function readSafe(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }

function resolveImportTarget(spec, file) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(file), spec);
  else return null;
  const candidates = [base, base + ".ts", base + ".tsx", path.join(base, "route.ts"), path.join(base, "handler.ts"), path.join(base, "index.ts")];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

function resolveImports(txt, file) {
  const parts = [];
  for (const imp of txt.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
    const target = resolveImportTarget(imp[1], file);
    if (target) parts.push({ file: target, text: readSafe(target) });
  }
  return parts;
}

function analyze(file) {
  const ownText = readSafe(file);
  const visited = new Set([fs.realpathSync(file)]);
  // 仅追一层转发目标（route.ts → handler/helper），用于判定是否有鉴权；
  // 不把整个 lib 依赖树的符号都归入本路由，避免鉴权种类误报。
  const queue = resolveImports(ownText, file).map(p => ({ file: p.file, text: p.text }));
  let forwardedText = "";
  let hops = 0;
  while (queue.length && hops < 4) {
    const cur = queue.shift();
    const real = fs.realpathSync(cur.file);
    if (visited.has(real)) continue;
    visited.add(real);
    hops += 1;
    forwardedText += "\n" + cur.text;
    for (const part of resolveImports(cur.text, cur.file)) {
      if (!visited.has(fs.realpathSync(part.file))) queue.push(part);
    }
  }
  // 鉴权种类只按路由文件自身 + 直接转发的 helper 归因；再深层的 lib 不归因，只用于保护判定。
  const attributionText = ownText + "\n" + forwardedText;
  const kinds = new Set();
  for (const k of AUTH_KINDS) if (k.re.test(attributionText)) kinds.add(k.id);
  const methods = [...new Set([...ownText.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map(m => m[1]))];
  const moduleIds = [...new Set([...attributionText.matchAll(/requireApiPermission\(\s*["']([^"']+)["']/g)].map(m => m[1]))];
  const actions = [...new Set([...attributionText.matchAll(/requireApiPermission\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']/g)].map(m => m[1]))];
  const workspaceFence = /assertWorkspaceAccess\(|workspaceScopeFromRequest\(/.test(attributionText);
  const hasAuth = kinds.size > 0;
  return {
    route: "/" + path.relative(API, file).replace(/\/route\.ts$/, "").replace(/\\/g, "/"),
    methods,
    authKinds: [...kinds].sort(),
    moduleIds,
    actions,
    workspaceFence,
    status: hasAuth ? "protected" : "public_or_unprotected",
  };
}

const routes = walk(API).sort().map(analyze);
const byKind = {};
for (const r of routes) for (const k of r.authKinds) byKind[k] = (byKind[k] ?? 0) + 1;
const summary = {
  generatedAt: new Date().toISOString(),
  totalRoutes: routes.length,
  protected: routes.filter(r => r.status === "protected").length,
  publicOrUnprotected: routes.filter(r => r.status === "public_or_unprotected").length,
  workspaceFenced: routes.filter(r => r.workspaceFence).length,
  authKindCounts: byKind,
  note: "公开/未保护条目为认证端点、健康检查、MCP Bearer 端点与低敏遥测；静态分析不执行路由。",
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "role-interface-matrix.json"), JSON.stringify({ summary, routes }, null, 2) + "\n");

const lines = [
  "# 角色 × 接口权限矩阵（自动生成）",
  "",
  `> 生成时间：${summary.generatedAt}`,
  `> 共 ${summary.totalRoutes} 个 API 路由，${summary.protected} 个受接口级/领域鉴权保护，${summary.publicOrUnprotected} 个公开或自带鉴权入口；${summary.workspaceFenced} 个带工作区围栏。`,
  "",
  "## 鉴权方式分布",
  "",
  "| 鉴权方式 | 路由数 |",
  "|---|---:|",
  ...Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| \`${k}\` | ${v} |`),
  "",
  "## 公开 / 自带鉴权入口（需人工确认）",
  "",
  "该类入口不走统一的 requireApiPermission，但多数由会话用户、领域鉴权或 Bearer 凭证保护；下表列出静态识别到的鉴权线索，便于逐条复核。",
  "",
  "| 路由 | 方法 | 鉴权线索 |",
  "|---|---|---|",
  ...routes.filter(r => r.status === "public_or_unprotected").map(r => `| \`${r.route}\` | ${r.methods.join(",")} | ${r.authKinds.join(", ") || "无（公开端点，如健康检查）"} |`),
  "",
  "## 全量接口明细",
  "",
  "| 路由 | 方法 | 鉴权方式 | 模块 | 动作 | 工作区围栏 |",
  "|---|---|---|---|---|---|",
  ...routes.map(r => `| \`${r.route}\` | ${r.methods.join(",")} | ${r.authKinds.join(", ") || "—"} | ${r.moduleIds.join(",") || "—"} | ${r.actions.join(",") || "—"} | ${r.workspaceFence ? "✓" : "—"} |`),
  "",
];
fs.writeFileSync(path.join(OUT_DIR, "role-interface-matrix.md"), lines.join("\n"));

console.log(`已生成角色×接口矩阵：${summary.totalRoutes} 路由，${summary.protected} 保护，${summary.publicOrUnprotected} 公开/自带鉴权`);
console.log(`  docs/security/role-interface-matrix.json`);
console.log(`  docs/security/role-interface-matrix.md`);

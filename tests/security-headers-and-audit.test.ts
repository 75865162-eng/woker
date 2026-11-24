import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const nextConfig = read("next.config.ts");

test("CSP 覆盖 script/connect/img 等关键指令，不再只有 frame-ancestors", () => {
  for (const directive of [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ]) {
    assert.ok(nextConfig.includes(`"${directive}`) || nextConfig.includes(`'${directive}`), `CSP 缺少指令: ${directive}`);
  }
  assert.match(nextConfig, /cspDirectives\.join\("; "\)/);
});

test("图片源仅含本地与 Amazon CDN 白名单，不含通配 https", () => {
  const imgLine = nextConfig.split("\n").find(line => line.includes("img-src")) ?? "";
  assert.match(imgLine, /m\.media-amazon\.com/);
  assert.match(imgLine, /ssl-images-amazon\.com/);
  assert.ok(!/"img-src[^"]*https: "/.test(imgLine), "img-src 不得放行任意 https 源");
});

test("CSP 支持 report-only 灰度开关", () => {
  assert.match(nextConfig, /ERP_CSP_REPORT_ONLY/);
  assert.match(nextConfig, /Content-Security-Policy-Report-Only/);
  // 保留严格 CSP 作为默认分支。
  assert.match(nextConfig, /: "Content-Security-Policy"/);
});

test("供应链闸门脚本：基线豁免 + 新增/升级/过期阻断", () => {
  const script = read("scripts/runtime/audit-dependencies.mjs");
  assert.match(script, /npm", \["audit", "--omit=dev", "--json"\]/);
  assert.match(script, /未登记豁免且达到阻断阈值/);
  assert.match(script, /严重级别由/);
  assert.match(script, /豁免已于/);
  assert.match(script, /process\.exit\(1\)/);
  assert.match(script, /fail-closed/);
});

test("漏洞基线每项均登记理由、backlog 与复审日期", () => {
  const baseline = JSON.parse(read("scripts/runtime/audit-baseline.json")) as {
    policy: { auditLevel: string };
    accepted: Array<{ package: string; severity: string; reason: string; backlog: string; reviewBy: string }>;
  };
  assert.equal(baseline.policy.auditLevel, "high");
  assert.ok(baseline.accepted.length >= 9);
  for (const item of baseline.accepted) {
    assert.ok(item.package && item.severity && item.reason.length > 10 && item.backlog && /^\d{4}-\d{2}-\d{2}$/.test(item.reviewBy));
  }
  const packages = new Set(baseline.accepted.map(i => i.package));
  for (const must of ["next", "prisma", "sharp", "undici"]) assert.ok(packages.has(must), `基线缺少 ${must}`);
});

test("CI 工作流纳入供应链闸门步骤", () => {
  const ci = read(".github/workflows/ci-cd.yml");
  assert.match(ci, /Supply-chain audit/);
  assert.match(ci, /npm run audit:deps/);
  // 闸门在 release 构建路径内执行，与 typecheck/lint 同级。
  const lintAt = ci.indexOf("name: Lint");
  const auditAt = ci.indexOf("Supply-chain audit");
  const buildAt = ci.indexOf("name: Build");
  assert.ok(lintAt > 0 && auditAt > lintAt && buildAt > auditAt, "闸门应位于 Lint 与 Build 之间");
});

test("package.json 暴露 audit:deps 脚本", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["audit:deps"], "node scripts/runtime/audit-dependencies.mjs");
});

test("角色×接口矩阵产物存在且覆盖全部路由", () => {
  const matrix = JSON.parse(read("docs/security/role-interface-matrix.json")) as {
    summary: { totalRoutes: number; protected: number; publicOrUnprotected: number };
    routes: Array<{ route: string; authKinds: string[]; status: string }>;
  };
  assert.equal(matrix.summary.totalRoutes, matrix.routes.length);
  assert.ok(matrix.summary.totalRoutes >= 240, "应覆盖全部 API 路由");
  assert.ok(matrix.summary.protected / matrix.summary.totalRoutes > 0.95, "绝大多数路由应受鉴权保护");
  const highRisk = ["/points/override", "/operations/wms/commands", "/accounts/access/matrix"];
  for (const route of highRisk) {
    const entry = matrix.routes.find(r => r.route === route);
    assert.ok(entry, `矩阵缺少高敏路由 ${route}`);
    assert.equal(entry.status, "protected");
    assert.ok(entry.authKinds.length > 0, `${route} 应有鉴权方式`);
  }
});

test("矩阵生成脚本可重复执行且纳入仓库", () => {
  const script = read("scripts/runtime/generate-role-interface-matrix.mjs");
  assert.match(script, /role-interface-matrix\.json/);
  assert.match(script, /role-interface-matrix\.md/);
  assert.match(script, /requireApiPermission/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { classifyChanges, discoverRelatedTests } from "../scripts/change-tier.mjs";

// 离线单测：只验证分级纯函数，不读 git、不加载 .env、不连数据库。
type TierResult = { tier: "fast" | "full"; reason: string; relatedTests: string[]; testScope: string[] };
const mod = {
  classifyChanges: classifyChanges as (input: {
    changedPaths: string[];
    statuses?: string[];
    allTests?: string[];
    guardTests?: string[];
  }) => TierResult,
  discoverRelatedTests: discoverRelatedTests as (changedPaths: string[], allTests: string[]) => string[],
};

const GUARDS = ["tests/auth-boundaries.test.ts", "tests/production-security.test.ts"];
const ALL_TESTS = [
  ...GUARDS,
  "tests/sellfox-field-registry.test.ts",
  "tests/sellfox-browse-query.test.ts",
  "tests/sellfox-row-actions.test.ts",
  "tests/amazon-ads-metrics.test.ts",
];

const classify = (changedPaths: string[], statuses: string[] = []) =>
  mod.classifyChanges({ changedPaths, statuses, allTests: ALL_TESTS, guardTests: GUARDS });

test("纯 UI/样式改动判为 fast，且带上守卫测试", () => {
  const result = classify([
    "src/components/sellfox/replica/replica-workbench.tsx",
    "src/app/(erp)/sellfox/sellfox-ui.css",
  ]);
  assert.equal(result.tier, "fast");
  assert.ok(result.testScope.includes("tests/auth-boundaries.test.ts"), "fast 档必带守卫测试");
  assert.ok(result.testScope.includes("tests/production-security.test.ts"), "fast 档必带守卫测试");
  assert.deepEqual(result.testScope, [...result.testScope].sort(), "testScope 去重排序");
});

test("UI 改动能带出词干匹配的相关测试", () => {
  const result = classify(["src/components/sellfox/field-registry.tsx"]);
  assert.equal(result.tier, "fast");
  assert.ok(result.testScope.includes("tests/sellfox-field-registry.test.ts"), "应发现 related test");
});

test("文档改动走 fast（docs-only 由 deployment-plan 判不发布，分级不越权）", () => {
  assert.equal(classify(["docs/some-guide.md"]).tier, "fast");
});

test("改到 src/lib 数据层判为 full", () => {
  const result = classify(["src/lib/sellfox/browse-query.ts"]);
  assert.equal(result.tier, "full");
  assert.match(result.reason, /high-risk path/);
});

test("改到 API 路由判为 full", () => {
  assert.equal(classify(["src/app/api/sellfox/sales/route.ts"]).tier, "full");
});

test("改到 CI/脚本/部署配置判为 full", () => {
  for (const file of [
    ".github/workflows/ci-cd.yml",
    "scripts/change-tier.mjs",
    "deploy/systemd/amazon-web.service",
    "package-lock.json",
    "prisma/schema.prisma",
    "prisma/migrations/20260101_x/migration.sql",
  ]) {
    assert.equal(classify([file]).tier, "full", `${file} 应为 full`);
  }
});

test("文件名含敏感语义（auth/scope/security 等）即使在 UI 目录也判 full", () => {
  for (const file of [
    "src/components/auth-guard.tsx",
    "src/app/(erp)/settings/scope-panel.tsx",
    "src/components/data-truth-view.tsx",
  ]) {
    assert.equal(classify([file]).tier, "full", `${file} 应为 full`);
  }
});

test("新增/删除/重命名一律 full", () => {
  assert.equal(classify(["src/app/(erp)/x/page.tsx"], ["A\tsrc/app/(erp)/x/page.tsx"]).tier, "full");
  assert.equal(classify(["src/components/a.tsx"], ["D\tsrc/components/a.tsx"]).tier, "full");
  assert.equal(classify(["src/components/b.tsx"], ["R042\ta.tsx\tsrc/components/b.tsx"]).tier, "full");
});

test("改动文件数超过阈值判为 full", () => {
  const many = Array.from({ length: 13 }, (_, i) => `src/components/c${i}.tsx`);
  const result = classify(many);
  assert.equal(result.tier, "full");
  assert.match(result.reason, /too many changed files/);
});

test("白名单外的路径判为 full", () => {
  assert.equal(classify(["README-ROOT.txt"]).tier, "full");
  assert.equal(classify(["src/hooks/use-thing.ts"]).tier, "full");
});

test("空改动判为 full（绝不零测试放行）", () => {
  assert.equal(classify([]).tier, "full");
});

test("相关测试发现：按词干匹配，不误匹配短词干", () => {
  const related = mod.discoverRelatedTests(
    ["src/lib/sellfox/field-registry.ts", "src/lib/sellfox/browse-query.ts"],
    ALL_TESTS,
  );
  assert.deepEqual(related, [
    "tests/sellfox-browse-query.test.ts",
    "tests/sellfox-field-registry.test.ts",
  ]);
});

test("子集过大（超过上限）判为 full", () => {
  const manyTests = GUARDS.concat(
    Array.from({ length: 51 }, (_, i) => `tests/foo-${i}.test.ts`),
  );
  const result = mod.classifyChanges({
    changedPaths: ["src/components/foo.tsx"],
    allTests: manyTests,
    guardTests: GUARDS,
  });
  // foo.tsx 词干过短不产生相关测试，但守卫测试存在；这里验证上限逻辑单独生效。
  assert.equal(result.tier, "fast");
  // 构造能被词干命中的大批测试。
  const hitTests = GUARDS.concat(
    Array.from({ length: 51 }, (_, i) => `tests/thing-${i}.test.ts`),
  );
  const big = mod.classifyChanges({
    changedPaths: ["src/components/thing.tsx"],
    allTests: hitTests,
    guardTests: GUARDS,
  });
  assert.equal(big.tier, "full");
  assert.match(big.reason, /subset too large/);
});

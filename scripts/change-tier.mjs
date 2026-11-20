import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 变更分级判定（方案二：分级门禁）。
 *
 * 设计原则：宁可判 full 漏掉提速，不可判 fast 漏掉检查。
 * - fast：仅当改动全部落在"安全白名单"、文件数少、无敏感路径/关键词、且无增删重命名。
 * - full：其余一切情况（数据/权限/迁移/多文件/新增删除/CI 脚本自身）。
 *
 * 本文件导出纯函数供单测；作为 CLI 运行时读取 git diff 并写出 change-tier.json。
 */

const MAX_FAST_FILES = 12;
const MAX_SUBSET_TESTS = 50;

// 只有这些路径允许进入 fast 档（正向白名单 = 默认拒绝）。
const SAFE_PATH = [
  /^src\/components\/.*\.tsx$/,
  /^src\/app\/(?!api\/).*\.(tsx|css)$/,
  /\.css$/,
  /^tests\/.*\.test\.(ts|mjs)$/,
  /^docs\//,
];

// 命中即 full：这些路径的改动必须走全套检查。
const HIGH_RISK_PATH = [
  /^prisma\//,
  /^package(-lock)?\.json$/,
  /^\.github\//,
  /^deploy\//,
  /^scripts\//,
  /^src\/app\/api\//,
  /^src\/workers\//,
  /^src\/lib\//,
  /^next\.config/,
  /^tsconfig/,
  /^docker-compose/,
];

// 文件名（basename）命中即 full，防御 UI 文件里夹带敏感语义。
const HIGH_RISK_WORD =
  /(auth|permission|rbac|tenant|scope|security|crypto|encrypt|credential|oauth|session|audit|isolation|migration|schema|data-truth|constraint)/i;

// fast 档无论如何都要跑的跨领域守卫测试（存在才纳入）。
const GUARD_TESTS = [
  "tests/auth-boundaries.test.ts",
  "tests/workspace-cache-isolation.test.ts",
  "tests/production-security.test.ts",
];

/** 找出与改动源文件相关的测试文件（按文件名词干匹配）。 */
export function discoverRelatedTests(changedPaths, allTests) {
  const stems = changedPaths
    .map((file) => path.basename(file).replace(/\.[^.]+$/, "").toLowerCase())
    .filter((stem) => stem.length >= 4);
  const matched = allTests.filter((testFile) => {
    const lower = testFile.toLowerCase();
    return stems.some((stem) => lower.includes(stem));
  });
  return [...new Set(matched)].sort();
}

/**
 * 纯函数：根据改动清单判定档位。
 * @param {{changedPaths: string[], statuses?: string[], allTests?: string[], guardTests?: string[]}} input
 */
export function classifyChanges({ changedPaths, statuses = [], allTests = [], guardTests = GUARD_TESTS }) {
  const paths = changedPaths.filter(Boolean);
  if (paths.length === 0) {
    return { tier: "full", reason: "no changed paths", relatedTests: [], testScope: [] };
  }

  // 新增 / 删除 / 重命名一律 full（保守：这类改动影响面难以用文件名推断）。
  const structural = statuses.filter((line) => /^[ADR]/i.test(line.trim()));
  if (structural.length) {
    return { tier: "full", reason: "add/delete/rename requires full suite", relatedTests: [], testScope: [] };
  }

  if (paths.length > MAX_FAST_FILES) {
    return { tier: "full", reason: `too many changed files (${paths.length} > ${MAX_FAST_FILES})`, relatedTests: [], testScope: [] };
  }

  const riskyPath = paths.find((file) => HIGH_RISK_PATH.some((re) => re.test(file)));
  if (riskyPath) {
    return { tier: "full", reason: `high-risk path: ${riskyPath}`, relatedTests: [], testScope: [] };
  }

  const riskyWord = paths.find((file) => HIGH_RISK_WORD.test(path.basename(file)));
  if (riskyWord) {
    return { tier: "full", reason: `sensitive filename: ${path.basename(riskyWord)}`, relatedTests: [], testScope: [] };
  }

  const unsafe = paths.find((file) => !SAFE_PATH.some((re) => re.test(file)));
  if (unsafe) {
    return { tier: "full", reason: `outside fast-path whitelist: ${unsafe}`, relatedTests: [], testScope: [] };
  }

  const related = discoverRelatedTests(paths, allTests);
  const scope = [...new Set([...guardTests, ...related])].filter((f) => allTests.includes(f)).sort();
  if (scope.length > MAX_SUBSET_TESTS) {
    return { tier: "full", reason: `subset too large (${scope.length} > ${MAX_SUBSET_TESTS})`, relatedTests: related, testScope: [] };
  }
  if (scope.length === 0) {
    return { tier: "full", reason: "no guard/related tests resolved", relatedTests: related, testScope: [] };
  }

  return { tier: "fast", reason: "UI/style/test-only change", relatedTests: related, testScope: scope };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBase() {
  const candidates = [process.env.BASE_SHA, "HEAD~1"].filter(Boolean);
  for (const ref of candidates) {
    try {
      return git("rev-parse", "--verify", `${ref}^{commit}`);
    } catch {
      // try next
    }
  }
  return null;
}

function listTests(root) {
  return readdirSync(path.join(root, "tests"))
    .filter((name) => /\.test\.(?:ts|mjs)$/.test(name))
    .sort()
    .map((name) => path.posix.join("tests", name));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baseSha = resolveBase();
  const headSha = git("rev-parse", "HEAD");
  const guardTests = GUARD_TESTS.filter((f) => existsSync(path.join(root, f)));
  const allTests = listTests(root);

  let changedPaths = [];
  let statuses = [];
  let reason = "resolved from git diff";
  if (!baseSha) {
    reason = "base SHA unavailable, fallback to full";
  } else {
    const nameStatus = git("diff", "--name-status", baseSha, headSha)
      .split("\n")
      .filter(Boolean);
    statuses = nameStatus;
    changedPaths = nameStatus.map((line) => line.split("\t").slice(-1)[0]);
  }

  const result = classifyChanges({ changedPaths, statuses, allTests, guardTests });
  // base 无法解析时强制 full（上面 classify 在空改动时已判 full，这里再兜一层语义）。
  const tier = baseSha ? result.tier : "full";
  const finalReason = baseSha ? result.reason : reason;

  const report = {
    baseSha,
    headSha,
    tier,
    reason: finalReason,
    changedPaths,
    relatedTests: result.relatedTests,
    testScope: tier === "fast" ? result.testScope : [],
  };

  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(path.join(root, "dist", "change-tier.json"), `${JSON.stringify(report, null, 2)}\n`);

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `tier=${tier}`,
      `test_count=${report.testScope.length}`,
      `reason=${finalReason.replace(/[\r\n]/g, " ")}`,
    ];
    writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, { flag: "a" });
  }

  console.log(JSON.stringify(report, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}

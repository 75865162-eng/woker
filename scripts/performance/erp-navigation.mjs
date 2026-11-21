// Real application pages and database authentication, in disposable resources only.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";
import { PERF_ROUTES, CORE_ROUTES, WARM_NAV_ROUTES, FIXTURE_MODULES } from "./perf-routes.mjs";
import { judgeAll } from "./perf-budget.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (args.some(a => !/^--(mode|output|baseline|source-dir|head|scope)=.+/.test(a))) throw Error("Use --mode=dev|production --output=path [--baseline=path] [--source-dir=path] [--head=sha] [--scope=core|all]");
const mode = option("mode", "dev");
assert.ok(["dev", "production"].includes(mode));
const output = path.resolve(option("output", `outputs/performance/${mode}.json`));
const baselinePath = option("baseline", "");
const sourceDir = path.resolve(option("source-dir", root));
// scope=all: 采集 PERF_ROUTES 全站; scope=core: 仅采 CORE 3 页(兼容既有 CI 快速回归)。
const scope = option("scope", "all");
assert.ok(["core", "all"].includes(scope));
const headSha = option("head", "");
const ledgerPath = path.join(root, "outputs/performance/LEDGER.json");
mkdirSync(path.join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(path.join(root, "tmp", "erp-performance-"));
const app = path.join(directory, "app");
const tag = randomUUID().slice(0, 8), container = `erp-performance-${tag}`;
const redisContainer = `${container}-redis`;
const fixtureLabel = `erp-performance-${tag}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const { Client } = createRequire(import.meta.url)("pg");
let created = false, redisCreated = false, db, server, browser, logs = "";
const pause = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await pause(300);
  }
  throw Error(`Timeout: ${label}`);
}
async function run(args, env) {
  const child = spawn(process.execPath, args, { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  assert.equal(code, 0, `Fixture command failed: ${logs.slice(-4000)}`);
}
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summary = values => ({ samples: values.map(n => Math.round(n * 100) / 100), median: percentile(values, .5), p95: percentile(values, .95) });
try {
  docker(["image", "inspect", "postgres:16-alpine"]);
  docker(["image", "inspect", "redis:7"]);
  docker(["run", "--pull=never", "-d", "--name", container, "--label", `codex.fixture=${fixtureLabel}`, "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=performance_fixture", "-e", "POSTGRES_DB=erp_performance_fixture", "-p", "127.0.0.1::5432", "postgres:16-alpine", "postgres", "-c", "log_min_duration_statement=0"]);
  created = true;
  const dbAddress = docker(["port", container, "5432/tcp"]);
  assert.match(dbAddress, /^127\.0\.0\.1:\d+$/);
  const databaseUrl = `postgresql://postgres:performance_fixture@${dbAddress}/erp_performance_fixture`;
  docker(["run", "--pull=never", "-d", "--name", redisContainer, "--label", `codex.fixture=${fixtureLabel}`, "--memory=128m", "--cpus=1", "-p", "127.0.0.1::6379", "redis:7"]);
  redisCreated = true;
  const redisAddress = docker(["port", redisContainer, "6379/tcp"]);
  assert.match(redisAddress, /^127\.0\.0\.1:\d+$/);
  await waitFor(async () => {
    try { return docker(["exec", redisContainer, "redis-cli", "ping"]) === "PONG"; } catch { return false; }
  }, "disposable Redis");
  await waitFor(async () => {
    const candidate = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); db = candidate; return true; } catch { await candidate.end(); return false; }
  }, "disposable PostgreSQL");
  mkdirSync(app);
  cpSync(path.join(sourceDir, "src"), path.join(app, "src"), { recursive: true });
  cpSync(path.join(sourceDir, "middleware.ts"), path.join(app, "middleware.ts"));
  // 保留全部 API：selection-local API 依赖仓库根的 scripts/selection-pipeline 源码，
  // 需一并复制进 fixture，否则 webpack 因模块缺失构建失败。
  if (existsSync(path.join(sourceDir, "scripts/selection-pipeline"))) {
    mkdirSync(path.join(app, "scripts"), { recursive: true });
    cpSync(path.join(sourceDir, "scripts/selection-pipeline"), path.join(app, "scripts/selection-pipeline"), { recursive: true });
  }
  mkdirSync(path.join(app, "public"));
  cpSync(path.join(sourceDir, "public/brand-logo.png"), path.join(app, "public/brand-logo.png"));
  // Generate the archived schema into fixture-owned modules, never the running
  // workspace client (which may be in use by unit tests or the dev server).
  const fixtureModules = path.join(app, "node_modules");
  mkdirSync(path.join(fixtureModules, "@prisma"), { recursive: true });
  for (const entry of readdirSync(path.join(root, "node_modules"))) {
    if (["@prisma", ".prisma"].includes(entry)) continue;
    symlinkSync(path.join(root, "node_modules", entry), path.join(fixtureModules, entry));
  }
  for (const entry of readdirSync(path.join(root, "node_modules/@prisma"))) {
    if (entry === "client") cpSync(path.join(root, "node_modules/@prisma", entry), path.join(fixtureModules, "@prisma", entry), { recursive: true });
    else symlinkSync(path.join(root, "node_modules/@prisma", entry), path.join(fixtureModules, "@prisma", entry));
  }
  for (const file of ["postcss.config.mjs", "tsconfig.json"]) cpSync(path.join(sourceDir, file), path.join(app, file));
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ private: true }));
  writeFileSync(path.join(app, ".gitignore"), "node_modules/\n.next-performance/\n");
  const cssPath = path.join(app, "src/app/globals.css");
  writeFileSync(cssPath, readFileSync(cssPath, "utf8").replace('@import "tailwindcss";', '@import "tailwindcss" source("../");'));
  // Keep the actual root/business layouts. Remove only remote font loading, equally in both measurements.
  const layoutPath = path.join(app, "src/app/layout.tsx");
  writeFileSync(layoutPath, readFileSync(layoutPath, "utf8")
    .replace(/^import \{ Geist, Geist_Mono \} from "next\/font\/google";\n/m, "")
    .replace(/const geistSans = Geist\([\s\S]*?\n\}\);\n/, "")
    .replace(/const geistMono = Geist_Mono\([\s\S]*?\n\}\);\n/, "")
    .replace(/className=\{`\$\{geistSans.variable\} \$\{geistMono.variable\} h-full antialiased`\}/, 'className="h-full antialiased"'));
  // 保留完整 src/app 树（全部页面 + 全部 API）。
  // 历史脚本用白名单删目录来省 build 成本，但页面间存在跨目录 import（如 @/app/api/products/handler、
  // scripts/selection-pipeline），删目录会导致 webpack 模块缺失。两种 scope 统一不删，
  // scope 只控制"采集哪些页"，不控制"构建哪些页"——正确性优先。
  writeFileSync(path.join(app, "next.config.mjs"), `export default {distDir:".next-performance",turbopack:{root:${JSON.stringify(root)}},typescript:{ignoreBuildErrors:true},eslint:{ignoreDuringBuilds:true}};`);
  const env = {
    PATH: process.env.PATH, TMPDIR: directory, ERP_RUNTIME_MODE: "production", NODE_ENV: "development",
    DATABASE_URL: databaseUrl, REDIS_URL: `redis://${redisAddress}/0`, AUTH_DRIVER: "database", AUTH_SECRET: "isolated-performance-fixture-secret-at-least-32-characters",
    NEXT_TELEMETRY_DISABLED: "1", ERP_PERFORMANCE_TRACE: "1",
    NODE_OPTIONS: `--import=${JSON.stringify(path.join(root, "tests/helpers/performance-process-preload.mjs"))}`,
  };
  const config = path.join(directory, "prisma.config.ts");
  writeFileSync(config, `import {defineConfig} from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};export default defineConfig({schema:${JSON.stringify(path.join(sourceDir, "prisma/schema.prisma"))},datasource:{url:${JSON.stringify(databaseUrl)}}});`);
  const generatorSchema = path.join(directory, "schema.prisma");
  writeFileSync(generatorSchema, readFileSync(path.join(sourceDir, "prisma/schema.prisma"), "utf8")
    .replace(/generator client \{/, `generator client {\n  output = ${JSON.stringify(path.join(app, "node_modules/.prisma/client"))}`));
  await run([path.join(root, "node_modules/prisma/build/index.js"), "generate", "--schema", generatorSchema], env);
  await run([path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--config", config], env);
  // Historical baselines predate explicit workspace grants. Only the archived
  // baseline may omit the model; the candidate must keep membership assertions.
  const hasWorkspaceMembership = (await db.query(`SELECT to_regclass('public."WorkspaceMembership"') IS NOT NULL AS present`)).rows[0].present;
  assert.ok(hasWorkspaceMembership || sourceDir !== root, "Candidate schema must include workspace membership");
  const passwordHash = `scrypt:fixture:${scryptSync("fixture_password", "fixture", 64).toString("base64url")}`;
  for (const [org, user] of [["perf-org", "perf-user"], ["other-org", "other-user"]]) {
    await db.query('INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())', [org]);
    await db.query('INSERT INTO "WorkspaceScope" ("organizationId",id,name,"isDefault","updatedAt") VALUES ($1,\'default\',$1,true,now())', [org]);
    await db.query('INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$1,$3,now())', [user, `${user}@fixture.invalid`, passwordHash]);
    await db.query('INSERT INTO "OrganizationMember" (id,"organizationId","userId",role,"updatedAt") VALUES ($1,$2,$3,\'viewer\',now())', [`${org}-member`, org, user]);
    if (hasWorkspaceMembership) await db.query('INSERT INTO "WorkspaceMembership" ("organizationId","workspaceId","userId") VALUES ($1,\'default\',$2)', [org, user]);
    const fixturePermissions = Object.fromEntries(FIXTURE_MODULES.map(m => [m, ["view"]]));
    fixturePermissions.imageUpscale = ["view"]; // redirect 壳目标也需要，保留既有行为
    await db.query('INSERT INTO "OrganizationRosterRole" ("organizationId",id,name,description,permissions,"sortOrder","updatedAt") VALUES ($1,\'viewer\',\'Viewer\',\'Fixture\',$2,0,now())', [org, JSON.stringify(fixturePermissions)]);
  }
  const socket = createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  env.AUTH_PUBLIC_ORIGIN = base;
  const next = path.join(root, "node_modules/next/dist/bin/next");
  if (mode === "production") { env.NODE_ENV = "production"; await run([next, "build", app], env); }
  server = spawn(process.execPath, [next, mode === "dev" ? "dev" : "start", app, ...(mode === "dev" ? ["--turbopack"] : []), "--hostname", "127.0.0.1", "--port", String(port)], { cwd: app, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const onLog = data => { logs += data; writeFileSync(path.join(directory, "server.log"), logs); };
  server.stdout.on("data", onLog); server.stderr.on("data", onLog);
  let readinessDetail = "No response received";
  try {
    await waitFor(async () => {
      if (server.exitCode !== null) throw Error(`Next fixture exited (${server.exitCode}): ${logs.slice(-8000)}`);
      try {
        const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(30000) });
        readinessDetail = `HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`;
        return response.ok;
      } catch (error) { readinessDetail = String(error); return false; }
    }, "Next fixture");
  } catch (error) {
    throw new Error(`${error.message}\nLast readiness response: ${readinessDetail}\nFixture server logs:\n${logs.slice(-12000)}`, { cause: error });
  }
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  // CAP-003: 浏览器渲染指标（LCP/INP）观察器，注入到每个新建文档，先于页面脚本执行。
  await context.addInitScript(() => {
    window.__perfLcp = null;
    window.__perfInp = 0;
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__perfLcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__perfInp = Math.max(window.__perfInp, entry.duration);
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    } catch { /* 浏览器不支持时降级为 null/0，不影响导航采集 */ }
  });
  const login = async (user = "perf-user") => {
    const at = performance.now();
    const response = await context.request.post(`${base}/api/auth/login`, { data: { email: `${user}@fixture.invalid`, password: "fixture_password" } });
    assert.equal(response.status(), 200, await response.text());
    return performance.now() - at;
  };
  const loginCold = await login();
  const loginSamples = [];
  for (let i = 0; i < 7; i++) loginSamples.push(await login());
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90000);
  const publicRequests = [];
  page.on("request", req => { const u = new URL(req.url()); if (/^\/api\/(workspaces|notifications)/.test(u.pathname)) publicRequests.push(u.pathname); });
  // scope=all 采集全站真实页；scope=core 仅 CORE 3 页（兼容既有 CI 快速回归）。
  const pages = scope === "all" ? PERF_ROUTES : CORE_ROUTES;
  const cold = [];
  for (const item of pages) {
    const at = performance.now();
    try {
      await page.goto(base + item.path, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByRole("heading", { name: item.heading, exact: true }).waitFor({ timeout: 30000 });
      const paint = await page.evaluate(() => {
        const fcpEntry = performance.getEntriesByName("first-contentful-paint")[0];
        return {
          fcpMs: fcpEntry ? Math.round(fcpEntry.startTime * 100) / 100 : null,
          lcpMs: window.__perfLcp != null ? Math.round(window.__perfLcp * 100) / 100 : null,
          inpMs: window.__perfInp ? Math.round(window.__perfInp * 100) / 100 : null,
        };
      });
      cold.push({ path: item.path, tier: item.tier ?? "A", module: item.module ?? null, totalMs: performance.now() - at, ...paint });
    } catch (error) {
      // 单页失败隔离：记录原因继续，不中断全站采集；判定阶段按 NO_DATA/FAIL 处理。
      cold.push({ path: item.path, tier: item.tier ?? "A", module: item.module ?? null, totalMs: null, error: String(error?.message ?? error).slice(0, 300) });
    }
    if (scope === "core") await pause(2500);
  }
  // Warm 导航用侧边栏真实存在的二级链接（WARM_NAV_ROUTES），先停到末页建立基线：
  // 第一次点 /product(不同页)才真正触发导航；链接均来自 business-navigation.ts items。
  const warmBase = WARM_NAV_ROUTES[WARM_NAV_ROUTES.length - 1];
  await page.goto(base + warmBase.path, { waitUntil: "domcontentloaded" });
  await pause(600); // 仅建立 nav DOM 基线；heading 由后续循环按 URL 判定，不强等
  // DOM identity detects remounts without adding production-only test hooks.
  await page.locator("aside nav").first().evaluate(el => { window.__perfOriginalNav = el; });
  publicRequests.length = 0;
  const warm = [], serverResponses = [];
  // 导航方式保留协作者重构：走 shell 自身的 cached-view tab bar（onSelect -> router.push）。
  // rebase 后 fixture 侧边栏为 7 组 portal 结构，旧 `aside nav a[href]` 已不存在，二级链接
  // 用 namespace routes 无法在归档 fixture 中解析；tab 切换仍保持缓存导航语义。
  // 连续重复访问同一视图，避免来回切换卡住 shell 的 route push。
  // 融合自驱动闭环容错：单步失败记 warmNote 并跳过，不中断全站 cold 主验收。
  const warmOrder = pages.flatMap(page => [page, page, page]);
  let warmNote = "";
  for (const item of warmOrder) {
    const at = performance.now();
    try {
      await page.locator(`[data-tab-href="${item.path}"]`).click({ timeout: 5000 });
      await page.getByRole("heading", { name: item.heading, exact: true }).waitFor({ timeout: 5000 });
      await page.waitForURL(base + item.path, { timeout: 10000 });
    } catch (error) {
      warmNote = warmNote || `warm 导航在 ${item.path} 失败,已跳过: ${String(error?.message ?? error).slice(0, 150)}`;
      break;
    }
    warm.push(performance.now() - at);
    // 通用视图身份断言：切回同一路由时 [data-workspace-view] 节点必须复用（不重挂载）。
    if (await page.locator(`[data-workspace-view="${item.path}"]`).count()) {
      const key = `__perfView_${item.path.replace(/\W/g, "_")}`;
      if (await page.evaluate(k => window[k] === undefined, key)) {
        await page.locator(`[data-workspace-view="${item.path}"]`).evaluate((node, k) => { window[k] = node; }, key);
      } else {
        assert.ok(await page.locator(`[data-workspace-view="${item.path}"]`).evaluate((node, k) => window[k] === node, key), `Cached view remounted: ${item.path}`);
      }
    }
    serverResponses.push(...await page.evaluate(() => performance.getEntriesByType("resource").filter(e => e.name.includes("_rsc=")).map(e => ({ ms: e.duration, ttfb: e.responseStart - e.requestStart }))));
    await page.evaluate(() => performance.clearResourceTimings());
  }
  const navigationRequests = [...publicRequests];
  const shellPersisted = await page.evaluate(() => window.__perfOriginalNav === document.querySelector("aside nav"));
  await pause(1800);
  publicRequests.length = 0;
  await page.evaluate(() => performance.clearResourceTimings());
  const workspaceRequest = () => context.request.get(base + "/api/listing-ai/workspace?workspaceId=default");
  if (hasWorkspaceMembership) {
    await db.query('DELETE FROM "WorkspaceMembership" WHERE "organizationId"=\'perf-org\' AND "userId"=\'perf-user\'');
    assert.equal((await workspaceRequest()).status(), 403, "workspace revocation takes effect on the next request");
    await db.query('INSERT INTO "WorkspaceMembership" ("organizationId","workspaceId","userId") VALUES (\'perf-org\',\'default\',\'perf-user\')');
    assert.equal((await workspaceRequest()).status(), 200, "explicit workspace grant restores access");
  }
  // Real-time role revocation must win over both layout state and any permission cache.
  const revokedPermissions = JSON.stringify(Object.fromEntries([...FIXTURE_MODULES, "imageUpscale"].map(m => [m, []])));
  await db.query('UPDATE "OrganizationRosterRole" SET permissions=$1,"updatedAt"=now() WHERE "organizationId"=\'perf-org\'', [revokedPermissions]);
  const revokedPermission = await context.request.get(base + "/api/listing-ai/workspace");
  assert.equal(revokedPermission.status(), 403, "server-side authorization reflects role revocation immediately");
  await page.goto(base + "/listing-ai?performanceCheck=" + randomUUID(), { waitUntil: "load" });
  if (new URL(page.url()).pathname !== "/forbidden") {
    await page.waitForURL(url => url.pathname === "/forbidden", { timeout: 10000 });
  }
  assert.equal(new URL(page.url()).pathname, "/forbidden", "role revocation takes effect on the next request");
  const me = await context.request.get(base + "/api/auth/me"); assert.equal(me.status(), 200);
  assert.equal((await me.json()).user.organizationId, "perf-org");
  await login("other-user");
  await page.goto(base + "/listing-ai", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Listing AI", exact: true }).waitFor();
  const other = await context.request.get(base + "/api/auth/me");
  assert.equal((await other.json()).user.organizationId, "other-org", "no cross-user/organization cache");
  await db.query('UPDATE "User" SET status=\'disabled\' WHERE id=\'other-user\'');
  assert.equal((await context.request.get(base + "/api/auth/me")).status(), 401, "disabled user is rejected immediately");
  const renderSamples = cold.filter(c => c.fcpMs != null);
  const renderSummary = {
    fcpP95: renderSamples.length ? percentile(renderSamples.map(c => c.fcpMs), .95) : null,
    lcpP95: renderSamples.length ? percentile(renderSamples.map(c => c.lcpMs).filter(n => n != null), .95) : null,
    inpMax: renderSamples.length ? Math.max(0, ...renderSamples.map(c => c.inpMs ?? 0)) : null,
    coveredPages: renderSamples.length,
  };
  const result = { schemaVersion: 2, mode, scope, head: headSha || null, bundler: mode === "dev" ? "turbopack" : "webpack", fixtureOnly: true, capturedAt: new Date().toISOString(), node: process.version,
    routes: pages.map(p => p.path), loginColdMs: loginCold, loginMs: summary(loginSamples), coldPages: cold,
    render: renderSummary, warmNavigationMs: summary(warm), warmNote: warmNote || null, rsc: serverResponses, shellPersisted, publicRequests: navigationRequests,
    checks: [...(hasWorkspaceMembership ? ["workspace membership revocation"] : []), "role revocation", "cross-organization identity", "disabled user"],
    limitations: ["Disposable database and synthetic accounts; not production acceptance", "External font loading excluded; CSS scan bounded to src in both measurements", "Cold page navigation includes domcontentloaded + initial heading settle", scope === "core" ? "CORE 3 routes only (fast CI regression)" : "Full real-route coverage from perf-routes.mjs; fixture data volume not production scale"],
  };
  // CAP-002: 逐页绝对达标判定；CAP-003: 结果追加写入 LEDGER 账本。
  // core 模式只对实际采集的 CORE 页判定，避免未采页被误记 NO_DATA/FAIL。
  const verdict = judgeAll(result, scope === "core" ? CORE_ROUTES : PERF_ROUTES);
  result.verdict = { pass: verdict.pass, passCount: verdict.passCount, failCount: verdict.failCount, total: verdict.total };
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  try {
    const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
    ledger.push({ capturedAt: result.capturedAt, head: result.head, mode, scope, env: verdict.env, passCount: verdict.passCount, failCount: verdict.failCount, verdict: verdict.rows, output: path.relative(root, output) });
    mkdirSync(path.dirname(ledgerPath), { recursive: true }); writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  } catch (error) {
    console.error("LEDGER 写入失败(不影响采集):", String(error?.message ?? error));
  }
  console.log(JSON.stringify(result, null, 2));
  // baseline 相对回归门禁只针对 core scope（warm/login 指标口径一致）；全站采集的绝对达标由 verdict 表达。
  if (baselinePath && scope === "core") {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(baseline.mode, mode, "Compare the same runtime mode");
    assert.deepEqual(baseline.routes, result.routes);
    assert.ok(shellPersisted, "Public shell remounted during navigation");
    for (const key of ["loginMs", "warmNavigationMs"]) {
      for (const metric of ["median", "p95"]) assert.ok(result[key][metric] <= baseline[key][metric] * 1.2, `${key}.${metric} regressed more than 20%: ${result[key][metric]} > ${baseline[key][metric]} * 1.2`);
    }
    assert.ok(navigationRequests.filter(p => p === "/api/workspaces").length <= 1, "Navigation repeatedly refetched workspaces");
    assert.ok(navigationRequests.filter(p => p === "/api/notifications/wecom/settings").length === 0, "Navigation restarted notification runner");
  }
} catch (error) {
  if (browser) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error("Fixture page state", await page.evaluate(() => ({
        url: location.href,
        headings: Array.from(document.querySelectorAll("h1,h2")).map(node => ({ text: node.textContent, visible: node.checkVisibility() })),
        views: Array.from(document.querySelectorAll("[data-workspace-view]")).map(node => ({ href: node.getAttribute("data-workspace-view"), hidden: node.hidden, hasContent: Boolean(node.textContent) })),
      })).catch(() => "Page unavailable"));
    }
  }
  console.error(error); mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output + ".log", logs); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    process.kill(-server.pid, "SIGTERM"); await new Promise(resolve => { const timeout = setTimeout(() => { try { process.kill(-server.pid, "SIGKILL"); } catch { /* Already exited. */ } resolve(); }, 10000); server.once("exit", () => { clearTimeout(timeout); resolve(); }); });
  }
  await db?.end();
  if (redisCreated) {
    assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "codex.fixture"}}', redisContainer]), fixtureLabel, "Owned Redis fixture identity");
    docker(["rm", "-f", redisContainer]);
  }
  if (created) {
    assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "codex.fixture"}}', container]), fixtureLabel, "Owned fixture identity");
    docker(["rm", "-f", container]);
  }
  rmSync(directory, { recursive: true, force: true });
}

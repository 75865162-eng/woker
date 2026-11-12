// Real application pages and database authentication, in disposable resources only.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { chromium } from "@playwright/test";

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (args.some(a => !/^--(mode|output|baseline|source-dir)=.+/.test(a))) throw Error("Use --mode=dev|production --output=path [--baseline=path] [--source-dir=path]");
const mode = option("mode", "dev");
assert.ok(["dev", "production"].includes(mode));
const output = path.resolve(option("output", `outputs/performance/${mode}.json`));
const baselinePath = option("baseline", "");
const sourceDir = path.resolve(option("source-dir", root));
mkdirSync(path.join(root, "tmp"), { recursive: true });
const directory = mkdtempSync(path.join(root, "tmp", "erp-performance-"));
const app = path.join(directory, "app");
const tag = randomUUID().slice(0, 8), container = `erp-performance-${tag}`;
const fixtureLabel = `erp-performance-${tag}`;
const docker = args => execFileSync("docker", args, { encoding: "utf8", env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const { Client } = createRequire(import.meta.url)("pg");
let created = false, db, server, browser, logs = "";
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
  docker(["run", "--pull=never", "-d", "--name", container, "--label", `codex.fixture=${fixtureLabel}`, "--memory=512m", "--cpus=1", "-e", "POSTGRES_PASSWORD=performance_fixture", "-e", "POSTGRES_DB=erp_performance_fixture", "-p", "127.0.0.1::5432", "postgres:16-alpine", "postgres", "-c", "log_min_duration_statement=0"]);
  created = true;
  const dbAddress = docker(["port", container, "5432/tcp"]);
  assert.match(dbAddress, /^127\.0\.0\.1:\d+$/);
  const databaseUrl = `postgresql://postgres:performance_fixture@${dbAddress}/erp_performance_fixture`;
  await waitFor(async () => {
    const candidate = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
    try { await candidate.connect(); db = candidate; return true; } catch { await candidate.end(); return false; }
  }, "disposable PostgreSQL");
  mkdirSync(app);
  cpSync(path.join(sourceDir, "src"), path.join(app, "src"), { recursive: true });
  cpSync(path.join(sourceDir, "middleware.ts"), path.join(app, "middleware.ts"));
  mkdirSync(path.join(app, "public"));
  cpSync(path.join(sourceDir, "public/brand-logo.png"), path.join(app, "public/brand-logo.png"));
  symlinkSync(path.join(root, "node_modules"), path.join(app, "node_modules"), "dir");
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
  // Limit build cost to real routes under test; no component/API mocks or synthetic page implementations.
  const keepPages = new Set(["listing-ai", "logistics", "history", "workspace", "forbidden"]);
  const appDir = path.join(app, "src/app");
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !["api", "login", "(erp)", ...keepPages].includes(entry.name)) rmSync(path.join(appDir, entry.name), { recursive: true });
  }
  if (existsSync(path.join(appDir, "(erp)"))) {
    for (const entry of readdirSync(path.join(appDir, "(erp)"), { withFileTypes: true })) {
      if (entry.isDirectory() && !keepPages.has(entry.name)) rmSync(path.join(appDir, "(erp)", entry.name), { recursive: true });
    }
  }
  for (const entry of readdirSync(path.join(appDir, "api"))) {
    if (!["auth", "workspaces", "notifications", "listing-ai", "ai-settings", "workspace"].includes(entry)) rmSync(path.join(appDir, "api", entry), { recursive: true });
  }
  writeFileSync(path.join(app, "next.config.mjs"), `export default {distDir:".next-performance",turbopack:{root:${JSON.stringify(root)}},typescript:{ignoreBuildErrors:true},eslint:{ignoreDuringBuilds:true}};`);
  const env = {
    PATH: process.env.PATH, TMPDIR: directory, ERP_RUNTIME_MODE: "production", NODE_ENV: "development",
    DATABASE_URL: databaseUrl, AUTH_DRIVER: "database", AUTH_SECRET: "isolated-performance-fixture-secret-at-least-32-characters",
    NEXT_TELEMETRY_DISABLED: "1", ERP_PERFORMANCE_TRACE: "1",
    NODE_OPTIONS: `--import=${JSON.stringify(path.join(root, "tests/helpers/performance-process-preload.mjs"))}`,
  };
  const config = path.join(directory, "prisma.config.ts");
  writeFileSync(config, `import {defineConfig} from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))};export default defineConfig({schema:${JSON.stringify(path.join(sourceDir, "prisma/schema.prisma"))},datasource:{url:${JSON.stringify(databaseUrl)}}});`);
  const generatorSchema = path.join(directory, "schema.prisma");
  writeFileSync(generatorSchema, readFileSync(path.join(sourceDir, "prisma/schema.prisma"), "utf8").replace(/provider\s*=\s*"prisma-client"/, 'provider = "prisma-client-js"').replace(/output\s*=\s*"[^"]+"/, `output = ${JSON.stringify(path.join(root, "node_modules/@prisma/client"))}`));
  await run([path.join(root, "node_modules/prisma/build/index.js"), "generate", "--schema", generatorSchema], env);
  await run([path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--config", config], env);
  const passwordHash = `scrypt:fixture:${scryptSync("fixture_password", "fixture", 64).toString("base64url")}`;
  for (const [org, user] of [["perf-org", "perf-user"], ["other-org", "other-user"]]) {
    await db.query('INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())', [org]);
    await db.query('INSERT INTO "WorkspaceScope" ("organizationId",id,name,"isDefault","updatedAt") VALUES ($1,\'default\',$1,true,now())', [org]);
    await db.query('INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$1,$3,now())', [user, `${user}@fixture.invalid`, passwordHash]);
    await db.query('INSERT INTO "OrganizationMember" (id,"organizationId","userId",role,"updatedAt") VALUES ($1,$2,$3,\'viewer\',now())', [`${org}-member`, org, user]);
    await db.query('INSERT INTO "OrganizationRosterRole" ("organizationId",id,name,description,permissions,"sortOrder","updatedAt") VALUES ($1,\'viewer\',\'Viewer\',\'Fixture\',$2,0,now())', [org, JSON.stringify({ listingAi: ["view"], logistics: ["view"], history: ["view"], workspace: ["view"], products: ["view"], operations: ["view"], agents: ["view"], searchMerge: ["view"], tasks: ["view"], sellfox: ["view"], versions: ["view"], accounts: ["view"], settings: ["view"], imageUpscale: ["view"] })]);
  }
  const socket = createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  const next = path.join(root, "node_modules/next/dist/bin/next");
  if (mode === "production") { env.NODE_ENV = "production"; await run([next, "build", app], env); }
  server = spawn(process.execPath, [next, mode === "dev" ? "dev" : "start", app, ...(mode === "dev" ? ["--turbopack"] : []), "--hostname", "127.0.0.1", "--port", String(port)], { cwd: app, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const onLog = data => { logs += data; writeFileSync(path.join(directory, "server.log"), logs); };
  server.stdout.on("data", onLog); server.stderr.on("data", onLog);
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs.slice(-4000)); try { return (await fetch(`${base}/login`, { signal: AbortSignal.timeout(30000) })).ok; } catch { return false; } }, "Next fixture");
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
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
  const pages = [
    { path: "/listing-ai", link: "Listing AI", heading: "Listing AI" },
    { path: "/logistics", link: "物流文件工作台", heading: "亚马逊物流处理系统（美国站）" },
    { path: "/workspace", link: "PPC Bulk 优化", heading: "PPC 优化工作台" },
  ];
  const cold = [];
  for (const item of pages) {
    const at = performance.now();
    await page.goto(base + item.path, { waitUntil: "load" });
    await page.getByRole("heading", { name: item.heading, exact: true }).waitFor();
    cold.push({ path: item.path, totalMs: performance.now() - at });
    await pause(2500);
  }
  // DOM identity detects remounts without adding production-only test hooks.
  await page.locator('nav[aria-label="业务导航"]').evaluate(el => { window.__perfOriginalNav = el; });
  publicRequests.length = 0;
  const warm = [], serverResponses = [];
  for (let i = 0; i < 9; i++) {
    const item = pages[i % pages.length];
    const at = performance.now();
    await page.getByRole("link", { name: item.link, exact: true }).click();
    await page.getByRole("heading", { name: item.heading, exact: true }).waitFor();
    await page.waitForURL(base + item.path);
    warm.push(performance.now() - at);
    serverResponses.push(...await page.evaluate(() => performance.getEntriesByType("resource").filter(e => e.name.includes("_rsc=")).map(e => ({ ms: e.duration, ttfb: e.responseStart - e.requestStart }))));
    await page.evaluate(() => performance.clearResourceTimings());
  }
  const navigationRequests = [...publicRequests];
  const shellPersisted = await page.evaluate(() => window.__perfOriginalNav === document.querySelector('nav[aria-label="业务导航"]'));
  await pause(1800);
  publicRequests.length = 0;
  await page.evaluate(() => performance.clearResourceTimings());
  // Real-time role revocation must win over both layout state and any permission cache.
  await db.query('UPDATE "OrganizationRosterRole" SET permissions=\'{"listingAi":[],"logistics":[],"workspace":[],"products":[],"operations":[],"agents":[],"searchMerge":[],"tasks":[],"sellfox":[],"versions":[],"accounts":[],"settings":[],"imageUpscale":[]}\',"updatedAt"=now() WHERE "organizationId"=\'perf-org\'');
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
  const result = { schemaVersion: 1, mode, bundler: mode === "dev" ? "turbopack" : "webpack", fixtureOnly: true, capturedAt: new Date().toISOString(), node: process.version,
    routes: pages.map(p => p.path), loginColdMs: loginCold, loginMs: summary(loginSamples), coldPages: cold,
    warmNavigationMs: summary(warm), rsc: serverResponses, shellPersisted, publicRequests: navigationRequests,
    checks: ["role revocation", "cross-organization identity", "disabled user"],
    limitations: ["Disposable database and synthetic accounts; not production acceptance", "External font loading excluded; CSS scan bounded to src in both measurements", "Cold page navigation includes networkidle settle time", "Selected real routes, not a full ERP benchmark"],
  };
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (baselinePath) {
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
  console.error(error); mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output + ".log", logs); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    process.kill(-server.pid, "SIGTERM"); await new Promise(resolve => { const timeout = setTimeout(() => { try { process.kill(-server.pid, "SIGKILL"); } catch { /* Already exited. */ } resolve(); }, 10000); server.once("exit", () => { clearTimeout(timeout); resolve(); }); });
  }
  await db?.end();
  if (created) {
    assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "codex.fixture"}}', container]), fixtureLabel, "Owned fixture identity");
    docker(["rm", "-f", container]);
  }
  rmSync(directory, { recursive: true, force: true });
}

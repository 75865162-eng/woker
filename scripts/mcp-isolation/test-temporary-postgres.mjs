#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { inspectDatabaseRoles } from "../../src/lib/mcp/database-audit.mjs";
import { assertFixtureContainer } from "../runtime/fixture-safety.mjs";

const image = "postgres:16-alpine";
const id = randomUUID();
const tag = id.slice(0, 8);
const labelKey = "io.woker.mcp-isolation-test-id";
const containerName = `woker-mcp-isolation-${id}`;
let containerId;
let port;
let admin;
let status = 1;
const log = [];

function docker(args) {
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "USERPROFILE", "HOME", "TEMP", "TMP"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  const result = spawnSync("docker", args, { env, encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${(result.stderr || result.error?.message || "unknown error").trim()}`);
  return result.stdout.trim();
}

function assertOwnedContainer() {
  if (!containerId) throw new Error("临时容器 ID 未记录");
  const inspected = JSON.parse(docker(["inspect", containerId]))[0];
  assertFixtureContainer(inspected, { id: containerId, name: containerName, tag, port, servicePort: 5432 });
  if (inspected.Config.Image !== image || inspected.Config.Labels?.[labelKey] !== id) {
    throw new Error("容器身份、镜像、标签或网络配置不匹配，拒绝连接/清理");
  }
  const bindings = inspected.NetworkSettings.Ports?.["5432/tcp"];
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== "127.0.0.1") {
    throw new Error("未能验证 PostgreSQL 仅映射到 loopback");
  }
  return Number(bindings[0].HostPort);
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const allocated = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return allocated;
}

async function waitForDatabase() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = new Client({ connectionString: `postgresql://postgres:temporary-admin-password@127.0.0.1:${port}/mcp_isolation_test`, connectionTimeoutMillis: 1000 });
    try {
      await candidate.connect();
      admin = candidate;
      return;
    } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      await delay(500);
    }
  }
  throw new Error(`临时 PostgreSQL 未就绪：${lastError?.code ?? lastError?.message ?? "unknown"}`);
}

async function runAudit() {
  const result = await inspectDatabaseRoles({
    AMAZON_MCP_PG_READONLY_URL: `postgresql://amazon_mcp_ro:temporary-amazon-password@127.0.0.1:${port}/mcp_isolation_test`,
    MCP_PG_READONLY_URL: `postgresql://sellfox_mcp_ro:temporary-sellfox-password@127.0.0.1:${port}/mcp_isolation_test`,
  });
  log.push(JSON.stringify(result));
  return result;
}

async function expectRejected(label, change, revert, identity = "amazon_mcp_ro") {
  await admin.query(change);
  const result = await runAudit();
  const role = result.roles.find(item => item.role === identity);
  if (!result.available || !role?.violations.some(item => item.includes("越界有效读取权限"))) throw new Error(`${label}: 未能确认审计器明确拒绝越权`);
  log.push(`EXPECTED_REJECTION ${label}: ${role?.violations.join("; ") || result.violations.join("; ")}`);
  await admin.query(revert);
  const recovered = await runAudit();
  if (!recovered.available || recovered.violations.length) throw new Error(`${label}: 撤销负例后权限未恢复`);
  log.push(`PASS 恢复：${label} 撤销后两池审计通过`);
}

try {
  const images = docker(["image", "inspect", image]);
  const imageInfo = JSON.parse(images)[0];
  if (imageInfo.RepoTags?.includes(image) !== true) throw new Error("本地镜像未确认，拒绝拉取或下载镜像");
  port = await reserveLoopbackPort();
  containerId = docker(["run", "--detach", "--pull=never", "--label", `${labelKey}=${id}`,
    "--label", "codex.task=erp-runtime-fixture", "--label", `erp.fixture.run=${tag}`, "--name", containerName,
    "--publish", `127.0.0.1:${port}:5432`, "--env", "POSTGRES_DB=mcp_isolation_test", "--env", "POSTGRES_USER=postgres",
    "--env", "POSTGRES_PASSWORD=temporary-admin-password", image]);
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("新建容器返回的 ID 无效，拒绝继续");
  assertOwnedContainer();
  await waitForDatabase();
  await admin.query("ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC; REVOKE CREATE, TEMP ON DATABASE mcp_isolation_test FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await admin.query(`CREATE ROLE amazon_mcp_ro LOGIN PASSWORD 'temporary-amazon-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE ROLE sellfox_mcp_ro LOGIN PASSWORD 'temporary-sellfox-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    CREATE TABLE public.\"AmazonOrders\" (id integer PRIMARY KEY, value text);
    CREATE TABLE public.\"AmazonInventory\" (id integer PRIMARY KEY, value text);
    CREATE TABLE public.\"SellfoxSales\" (id integer PRIMARY KEY, value text);
    CREATE TABLE public.\"SellfoxAds\" (id integer PRIMARY KEY, value text);
    INSERT INTO public.\"AmazonOrders\" VALUES (1, 'isolated-test');
    INSERT INTO public.\"SellfoxSales\" VALUES (1, 'isolated-test');`);

  const grantSql = readFileSync(new URL("./grant-roles.sql", import.meta.url), "utf8");
  await admin.query(grantSql);
  const baseline = await runAudit();
  if (!baseline.available || baseline.violations.length) throw new Error(`合法权限未通过: ${baseline.violations.join("; ")}`);
  log.push("PASS 正向：两实际登录角色仅能读各自池表，现有数据库审计通过");

  await expectRejected("跨池表级 SELECT", "GRANT SELECT ON public.\"SellfoxSales\" TO amazon_mcp_ro", "REVOKE SELECT ON public.\"SellfoxSales\" FROM amazon_mcp_ro");
  await expectRejected("跨池列级 SELECT", "GRANT SELECT (value) ON public.\"SellfoxSales\" TO amazon_mcp_ro", "REVOKE SELECT (value) ON public.\"SellfoxSales\" FROM amazon_mcp_ro");
  await admin.query("CREATE ROLE mcp_cross_pool_group NOLOGIN; GRANT SELECT ON public.\"SellfoxSales\" TO mcp_cross_pool_group; GRANT mcp_cross_pool_group TO amazon_mcp_ro");
  const membership = await runAudit();
  const memberRole = membership.roles.find(item => item.role === "amazon_mcp_ro");
  if (!membership.available || !memberRole?.violations.includes("不安全或未知角色属性：membership")) throw new Error("跨池角色继承未被现有审计器明确拒绝");
  log.push(`EXPECTED_REJECTION 跨池角色继承: ${memberRole.violations.join("; ")}`);
  await admin.query("REVOKE mcp_cross_pool_group FROM amazon_mcp_ro; REVOKE SELECT ON public.\"SellfoxSales\" FROM mcp_cross_pool_group; DROP ROLE mcp_cross_pool_group");
  const restored = await runAudit();
  if (!restored.available || restored.violations.length) throw new Error(`撤销继承负例后未恢复: ${restored.violations.join("; ")}`);
  log.push("PASS 负例清理后：两池权限恢复到基线");
  status = 0;
} catch (error) {
  log.push(`FAIL ${error.stack || error.message}`);
  if (!admin) {
    for (const check of ["两实际登录角色正向与跨池拒绝", "跨池表级 SELECT 负例与恢复", "跨池列级 SELECT 负例与恢复", "跨池角色继承负例与恢复"]) {
      log.push(`BLOCKED ${check}：临时数据库连接未就绪，未执行`);
    }
  }
} finally {
  if (admin) {
    try { await admin.end(); } catch {}
  }
  if (containerId) {
    try {
      assertOwnedContainer();
      docker(["rm", "--force", "--volumes", containerId]);
      log.push("CLEANUP 已删除身份核验通过的本次临时容器及匿名卷");
    } catch (error) {
      status = 1;
      log.push(`CLEANUP_BLOCKED ${error.message}`);
    }
  }
  const output = `${log.join("\n")}\n`;
  const outputPath = resolve("outputs/prelaunch-continue-mcp-20261117.log");
  writeFileSync(outputPath, output, { encoding: "utf8", flag: "w" });
  process.stdout.write(`${output}LOG ${outputPath}\n`);
}
process.exitCode = status;

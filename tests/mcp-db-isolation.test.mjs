import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditQueries, evaluateAudit, inspectRole, rolePolicies } from "../scripts/mcp-isolation/audit-roles.mjs";
import { inspectDatabaseRoles, probeDatabaseRole } from "../src/lib/mcp/database-audit.mjs";

function clean(policy = rolePolicies[0]) {
  return {
    identity: Object.fromEntries([["role", policy.role], ["session_role", policy.role],
      ...["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "membership", "owns_objects", "db_create", "db_temp", "unsafe_defaults", "public_acl"].map(key => [key, false])]),
    relations: [
      { schema: "public", name: `${policy.prefix}Order`, kind: "r", readable: true, writable: false, grantable: false },
      { schema: "public", name: `${policy.prefix === "Amazon" ? "Sellfox" : "Amazon"}Order`, kind: "r", readable: false, writable: false, grantable: false },
    ],
    schemas: [{ name: "public", creatable: false }], functions: [],
  };
}

test("两侧角色采用唯一命名且干净有效权限通过", () => {
  assert.deepEqual(rolePolicies.map(p => p.role), ["amazon_mcp_ro", "sellfox_mcp_ro"]);
  for (const policy of rolePolicies) assert.deepEqual(evaluateAudit(policy, clean(policy)).violations, []);
});

test("PUBLIC、列权限或继承导致的有效跨池读取均拒绝", () => {
  for (const policy of rolePolicies) {
    const snapshot = clean(policy);
    snapshot.relations.push({ schema: "public", name: policy.prefix === "Amazon" ? "SellfoxOrder" : "AmazonOrder", kind: "r", readable: true, writable: false, grantable: false });
    assert.match(evaluateAudit(policy, snapshot).violations.join(" "), /越界有效读取/);
  }
  assert.match(auditQueries.identity, /d\.defaclrole = c\.relowner AND d\.defaclnamespace = 0 AND d\.defaclobjtype = 'f'/);
  assert.match(auditQueries.relations, /has_any_column_privilege/);
  assert.match(auditQueries.relations, /FROM pg_class/);
  assert.doesNotMatch(auditQueries.relations, /information_schema\.tables/);
});

test("非提供方表、其他schema、视图及序列的有效读取均拒绝", () => {
  for (const relation of [
    { schema: "public", name: "User", kind: "r" },
    { schema: "other", name: "AmazonOrder", kind: "r" },
    { schema: "public", name: "AmazonFacade", kind: "v" },
    { schema: "public", name: "AmazonOrder_id_seq", kind: "S" },
  ]) {
    const snapshot = clean();
    snapshot.relations.push({ ...relation, readable: true, writable: false, grantable: false });
    assert.match(evaluateAudit(rolePolicies[0], snapshot).violations.join(" "), /越界有效读取/);
  }
});

test("角色切换、危险属性、成员、默认授权与对象所有权均失败关闭", () => {
  for (const key of ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "membership", "owns_objects", "db_create", "db_temp", "unsafe_defaults", "public_acl"]) {
    const snapshot = clean();
    snapshot.identity[key] = true;
    assert.ok(evaluateAudit(rolePolicies[0], snapshot).violations.some(v => v.includes(key)));
  }
  const snapshot = clean();
  snapshot.identity.session_role = "admin";
  assert.match(evaluateAudit(rolePolicies[0], snapshot).violations.join(" "), /连接身份/);
});

test("写入、转授权、函数执行、CREATE与空库均不通过", () => {
  const snapshot = clean();
  snapshot.relations[0].writable = true;
  snapshot.relations[0].grantable = true;
  snapshot.schemas[0].creatable = true;
  snapshot.functions.push({ schema: "public", name: "read_other_pool" });
  assert.equal(evaluateAudit(rolePolicies[0], snapshot).violations.length, 4);
  snapshot.relations = [];
  assert.match(evaluateAudit(rolePolicies[0], snapshot).violations.join(" "), /没有可读/);
});

test("缺配置不创建连接，查询只读且异常不泄露连接信息", async () => {
  class Unused { constructor() { throw new Error("禁止连接"); } }
  assert.equal((await inspectRole(rolePolicies[0], "", Unused)).unavailable, true);
  const queries = [];
  class FakeClient {
    async connect() {}
    async query(query) {
      if (query.startsWith("SELECT 1 FROM")) throw Object.assign(new Error("权限拒绝"), { code: "42501" });
      queries.push(query);
      const key = Object.keys(auditQueries).find(key => auditQueries[key] === query);
      const snapshot = clean();
      return { rows: key === "identity" ? [snapshot.identity] : snapshot[key] ?? [] };
    }
    async end() {}
  }
  assert.deepEqual((await inspectRole(rolePolicies[0], "offline-fixture", FakeClient)).violations, []);
  assert.equal(queries[0], "BEGIN READ ONLY");
  assert.equal(queries.at(-1), "ROLLBACK");
  class FailedClient extends FakeClient { async connect() { throw new Error("postgres://secret"); } }
  assert.doesNotMatch(JSON.stringify(await inspectRole(rolePolicies[0], "offline-fixture", FailedClient)), /secret/);
});

test("状态审计及两侧探针都使用实际独立连接，错误身份和越权不得报成功", async () => {
  const connections = [];
  class FakeClient {
    constructor(config) { this.config = config; connections.push(config.connectionString); }
    async connect() {}
    async end() {}
    async query(query) {
      if (query.startsWith("SELECT 1 FROM")) throw Object.assign(new Error("权限拒绝"), { code: "42501" });
      const policy = this.config.connectionString.includes("sellfox") ? rolePolicies[1] : rolePolicies[0];
      const snapshot = clean(policy);
      if (this.config.connectionString.includes("wrong")) snapshot.identity.role = "admin";
      if (this.config.connectionString.includes("cross")) snapshot.relations.push({ schema: "public", name: "User", kind: "r", readable: true, writable: false, grantable: false });
      const key = Object.keys(auditQueries).find(key => auditQueries[key] === query);
      return { rows: key === "identity" ? [snapshot.identity] : snapshot[key] ?? [] };
    }
  }
  const environment = { AMAZON_MCP_PG_READONLY_URL: "amazon-fixture", MCP_PG_READONLY_URL: "sellfox-fixture", DATABASE_URL: "must-never-connect" };
  assert.equal((await inspectDatabaseRoles(environment, FakeClient)).violations.length, 0);
  for (const provider of ["amazon", "sellfox"]) {
    assert.equal((await probeDatabaseRole(provider, environment, FakeClient)).ok, true);
    const key = provider === "amazon" ? "AMAZON_MCP_PG_READONLY_URL" : "MCP_PG_READONLY_URL";
    for (const suffix of ["wrong", "cross"]) assert.equal((await probeDatabaseRole(provider, { ...environment, [key]: `${provider}-${suffix}` }, FakeClient)).ok, false);
    assert.equal((await probeDatabaseRole(provider, { ...environment, [key]: "" }, FakeClient)).ok, false);
  }
  assert.ok(connections.every(value => value !== environment.DATABASE_URL));
  const route = readFileSync(new URL("../src/app/api/operations/mcp-isolation/route.ts", import.meta.url), "utf8");
  assert.match(route, /import \{ inspectDatabaseRoles, probeDatabaseRole \} from "@\/lib\/mcp\/database-audit\.mjs"/);
  assert.match(route, /return json\(await probeDatabaseRole\(provider\)\)/);
  assert.doesNotMatch(route, /information_schema|\$queryRaw|probeSellfoxReadOnly/);
  assert.doesNotMatch(route, /state: (sellfoxReadonly|amazonReadonly) \? "ok"/);
});

test("缺失权限布尔值或查询集合必须标记未知，不能按false通过", () => {
  for (const key of ["readable", "writable", "grantable"]) {
    for (const value of [undefined, null, "false", 0]) {
      const snapshot = clean();
      snapshot.relations[0][key] = value;
      const result = evaluateAudit(rolePolicies[0], snapshot);
      assert.equal(result.unavailable, true);
      assert.ok(result.violations.length > 0);
    }
  }
  for (const key of ["relations", "schemas", "functions"]) {
    const snapshot = clean();
    delete snapshot[key];
    assert.equal(evaluateAudit(rolePolicies[0], snapshot).unavailable, true);
  }
  for (const invalid of [null, undefined, { relations: [null], schemas: [null], functions: [] }]) {
    assert.equal(evaluateAudit(rolePolicies[0], invalid).unavailable, true);
  }
  const snapshot = clean();
  delete snapshot.schemas[0].creatable;
  assert.equal(evaluateAudit(rolePolicies[0], snapshot).unavailable, true);
  snapshot.schemas = [];
  assert.equal(evaluateAudit(rolePolicies[0], snapshot).unavailable, true);
});

test("构造连接失败和同步清理异常不得泄露凭证或覆盖审计结果", async () => {
  class ConstructorFailure { constructor() { throw new Error("postgres://private-credential"); } }
  const result = await inspectRole(rolePolicies[0], "offline-fixture", ConstructorFailure);
  assert.equal(result.unavailable, true);
  assert.doesNotMatch(JSON.stringify(result), /private-credential/);
  const environment = { AMAZON_MCP_PG_READONLY_URL: "offline-fixture", MCP_PG_READONLY_URL: "offline-fixture" };
  assert.equal((await inspectDatabaseRoles(environment, ConstructorFailure)).available, false);
  for (const provider of ["amazon", "sellfox"]) {
    assert.equal((await probeDatabaseRole(provider, environment, ConstructorFailure)).ok, false);
  }
  class CleanupFailure {
    async connect() {}
    async query(query) {
      if (query.startsWith("SELECT 1 FROM")) throw Object.assign(new Error("权限拒绝"), { code: "42501" });
      const key = Object.keys(auditQueries).find(key => auditQueries[key] === query);
      const snapshot = clean();
      return { rows: key === "identity" ? [snapshot.identity] : snapshot[key] ?? [] };
    }
    end() { throw new Error("postgres://private-credential"); }
  }
  assert.deepEqual((await inspectRole(rolePolicies[0], "offline-fixture", CleanupFailure)).violations, []);
});

test("跨池 SELECT 必须实际返回42501，成功、未知错误及缺另一池表均不能通过", async () => {
  for (const outcome of ["denied", "allowed", "unknown", "missing"]) {
    const queries = [];
    class ProbeClient {
      async connect() {}
      async end() {}
      async query(query) {
        queries.push(query);
        if (query.startsWith("SELECT 1 FROM")) {
          if (outcome !== "allowed") throw Object.assign(new Error("脱敏错误"), { code: outcome === "denied" ? "42501" : "42P01" });
          return { rows: [] };
        }
        const snapshot = clean();
        if (outcome === "missing") snapshot.relations.pop();
        const key = Object.keys(auditQueries).find(key => auditQueries[key] === query);
        return { rows: key === "identity" ? [snapshot.identity] : snapshot[key] ?? [] };
      }
    }
    const result = await inspectRole(rolePolicies[0], "offline-fixture", ProbeClient);
    assert.equal(result.violations.length === 0, outcome === "denied", outcome);
    if (outcome !== "missing") {
      assert.ok(queries.includes('SELECT 1 FROM "public"."SellfoxOrder" LIMIT 0'));
      assert.ok(queries.includes("ROLLBACK TO SAVEPOINT cross_pool_probe"));
    }
    assert.equal(queries.at(-1), "ROLLBACK");
  }
});

test("授权入口只输出单一事务SQL，不读取凭证也不能自动执行", () => {
  const script = new URL("../scripts/mcp-isolation/apply-roles.mjs", import.meta.url);
  const sql = readFileSync(new URL("../scripts/mcp-isolation/grant-roles.sql", import.meta.url), "utf8");
  const result = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, sql);
  const refused = spawnSync(process.execPath, [fileURLToPath(script), "--apply"], { encoding: "utf8" });
  assert.equal(refused.status, 2);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /pg_auth_members/);
  assert.match(sql, /aclexplode\(a\.attacl\)/);
  assert.match(sql, /REVOKE ALL PRIVILEGES \(%I\)/);
  assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES[\s\S]*GRANT/);
  assert.doesNotMatch(sql, /mcp_amazon_ro|mcp_sellfox_ro/);
});

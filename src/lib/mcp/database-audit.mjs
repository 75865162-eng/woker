/** 只读有效权限审计；只读取显式进程配置，不加载 .env，不输出连接凭证。 */
export const rolePolicies = [
  { role: "amazon_mcp_ro", prefix: "Amazon", env: "AMAZON_MCP_PG_READONLY_URL" },
  { role: "sellfox_mcp_ro", prefix: "Sellfox", env: "MCP_PG_READONLY_URL" },
];

export const auditQueries = {
  identity: `SELECT current_user::text AS role, session_user::text AS session_role,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
    EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS membership,
    EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = r.oid AND deptype = 'o') AS owns_objects,
    has_database_privilege(current_user, current_database(), 'CREATE') AS db_create,
    has_database_privilege(current_user, current_database(), 'TEMP') AS db_temp,
    EXISTS (SELECT 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
      WHERE a.grantee IN (0, r.oid))
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
      AND NOT EXISTS (SELECT 1 FROM pg_default_acl d
        WHERE d.defaclrole = c.relowner AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')) AS unsafe_defaults,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
      LATERAL aclexplode(c.relacl) a WHERE a.grantee = 0
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_')
    OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(a.attacl) x
      WHERE x.grantee = 0 AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_') AS public_acl
    FROM pg_roles r WHERE r.rolname = current_user`,
  relations: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(current_user, c.oid, 'SELECT,USAGE,UPDATE')
      ELSE has_table_privilege(current_user, c.oid, 'SELECT')
        OR has_any_column_privilege(current_user, c.oid, 'SELECT') END AS readable,
    CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE')
      ELSE has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES') END AS writable,
    CASE WHEN c.relkind = 'S' THEN false ELSE has_table_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION')
      OR has_any_column_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION') END AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')`,
  schemas: `SELECT nspname AS name, has_schema_privilege(current_user, oid, 'CREATE') AS creatable
    FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_'`,
  functions: `SELECT n.nspname AS schema, p.proname AS name FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')`,
};

export function evaluateAudit(policy, snapshot) {
  const violations = [];
  const identity = snapshot?.identity;
  let incomplete = false;
  for (const key of ["relations", "schemas", "functions"]) {
    if (!Array.isArray(snapshot?.[key])) {
      incomplete = true;
      violations.push(`权限查询结果缺失或无效：${key}`);
    }
  }
  const relations = Array.isArray(snapshot?.relations) ? snapshot.relations : [];
  const schemas = Array.isArray(snapshot?.schemas) ? snapshot.schemas : [];
  const functions = Array.isArray(snapshot?.functions) ? snapshot.functions : [];
  if (!identity || identity.role !== policy.role || identity.session_role !== policy.role) {
    violations.push(`连接身份必须为 ${policy.role}，不能使用管理员或 SET ROLE 代验`);
  }
  for (const key of ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "membership", "owns_objects", "db_create", "db_temp", "unsafe_defaults", "public_acl"]) {
    if (identity?.[key] !== false) violations.push(`不安全或未知角色属性：${key}`);
  }
  let allowedReadable = 0;
  const validRelations = [];
  for (const relation of relations) {
    if (!relation || !["schema", "name", "kind"].every(key => typeof relation[key] === "string" && relation[key].length > 0)
      || !["readable", "writable", "grantable"].every(key => typeof relation[key] === "boolean")) {
      incomplete = true;
      violations.push("关系对象或有效权限字段缺失，不能确认隔离");
      continue;
    }
    validRelations.push(relation);
    const allowed = relation.schema === "public" && ["r", "p"].includes(relation.kind) && relation.name.startsWith(policy.prefix);
    const name = `${relation.schema}.${relation.name}`;
    if (allowed && relation.readable) allowedReadable++;
    if (allowed && !relation.readable) violations.push(`缺少本提供方 SELECT：${name}`);
    if (!allowed && relation.readable) violations.push(`越界有效读取权限：${name}`);
    if (relation.writable) violations.push(`存在有效写入/DDL权限：${name}`);
    if (relation.grantable) violations.push(`存在转授权权限：${name}`);
  }
  if (!allowedReadable) violations.push("没有可读的本提供方表，不能按空结果宣称通过");
  if (!schemas.length) {
    incomplete = true;
    violations.push("缺少应用 schema 权限查询结果，不能确认隔离");
  }
  for (const schema of schemas) {
    if (!schema || typeof schema.name !== "string" || !schema.name || typeof schema.creatable !== "boolean") {
      incomplete = true;
      violations.push("schema 对象或 CREATE 权限字段缺失，不能确认隔离");
    } else if (schema.creatable) violations.push(`可创建对象：${schema.name}`);
  }
  for (const routine of functions) violations.push(`可执行应用函数/过程：${routine?.schema ?? "未知"}.${routine?.name ?? "未知"}`);
  const countReadable = prefix => validRelations.filter(relation =>
    relation.schema === "public" && ["r", "p"].includes(relation.kind) && relation.name.startsWith(prefix) && relation.readable).length;
  return { role: policy.role, unavailable: incomplete, allowedReadable, amazonTables: countReadable("Amazon"), sellfoxTables: countReadable("Sellfox"), violations };
}

export async function inspectRole(policy, connectionString, Client) {
  if (!connectionString?.trim()) return { role: policy.role, violations: [`缺少 ${policy.env}`], unavailable: true };
  let client;
  try {
    client = new Client({ connectionString, connectionTimeoutMillis: 8000, statement_timeout: 15000 });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const snapshot = {};
    for (const [key, query] of Object.entries(auditQueries)) {
      const { rows } = await client.query(query);
      snapshot[key] = key === "identity" ? rows[0] : rows;
    }
    const result = evaluateAudit(policy, snapshot);
    // 目录权限检查之外，实测跨池 SELECT；SAVEPOINT 隔离预期的权限拒绝。
    const opposite = policy.prefix === "Amazon" ? "Sellfox" : "Amazon";
    const target = snapshot.relations.find(relation => relation.schema === "public"
      && ["r", "p"].includes(relation.kind) && relation.name.startsWith(opposite));
    if (!target) {
      result.violations.push("缺少另一提供方表，无法执行跨池 SELECT 拒绝验收");
    } else {
      const identifier = value => `"${value.replaceAll('"', '""')}"`;
      await client.query("SAVEPOINT cross_pool_probe");
      try {
        await client.query(`SELECT 1 FROM ${identifier(target.schema)}.${identifier(target.name)} LIMIT 0`);
        result.violations.push("跨池 SELECT 未被数据库拒绝");
      } catch (error) {
        if (error?.code !== "42501") {
          result.unavailable = true;
          result.violations.push("跨池 SELECT 未返回预期权限拒绝，验收未知");
        }
      }
      await client.query("ROLLBACK TO SAVEPOINT cross_pool_probe");
    }
    await client.query("ROLLBACK");
    return result;
  } catch {
    // 驱动错误可能含连接信息，不将原始错误回显。
    return { role: policy.role, violations: ["连接或权限查询不可用，隔离状态未知"], unavailable: true };
  } finally {
    if (client) {
      try { await client.end(); } catch { /* 清理失败不泄露连接信息或覆盖审计结果。 */ }
    }
  }
}

export async function inspectDatabaseRoles(environment = process.env, ClientOverride) {
  const Client = ClientOverride ?? (await import("pg")).Client;
  const roles = await Promise.all(rolePolicies.map(policy => inspectRole(policy, environment[policy.env], Client)));
  return {
    available: roles.every(role => !role.unavailable),
    roles,
    violations: roles.flatMap(role => role.violations.map(violation => `${role.role}: ${violation}`)),
    note: "两实际只读登录的有效权限审计（含 PUBLIC、列授权及继承）；仓库整改不代表数据库授权已实施。",
  };
}

export async function probeDatabaseRole(provider, environment = process.env, ClientOverride) {
  const startedAt = Date.now();
  const policy = rolePolicies.find(policy => policy.prefix === (provider === "amazon" ? "Amazon" : "Sellfox"));
  const Client = ClientOverride ?? (await import("pg")).Client;
  const audit = await inspectRole(policy, environment[policy.env], Client);
  const ok = !audit.unavailable && audit.violations.length === 0;
  return { provider, ok, latencyMs: Date.now() - startedAt,
    detail: ok ? `${policy.role} 独立连接及有效权限审计通过` : audit.violations.join("；"), audit };
}

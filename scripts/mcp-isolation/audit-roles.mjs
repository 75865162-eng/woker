/** 双池数据库角色隔离审计（只读，不执行任何 DDL/GRANT）。
 * 用法：node scripts/mcp-isolation/audit-roles.mjs
 * 退出码 0 = 无跨池越权；1 = 存在越权或连接失败；2 = 缺少必要配置。
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line))
    .map(line => [line.split("=")[0], line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);

async function inspect(label, connectionString) {
  if (!connectionString) return { label, configured: false };
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT current_user::text AS role,
             count(*) FILTER (WHERE table_name LIKE 'Amazon%'
               AND has_table_privilege(current_user, quote_ident(table_name), 'SELECT'))::int AS amazon_tables_readable,
             count(*) FILTER (WHERE table_name LIKE 'Sellfox%'
               AND has_table_privilege(current_user, quote_ident(table_name), 'SELECT'))::int AS sellfox_tables_readable
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
        AND (table_name LIKE 'Amazon%' OR table_name LIKE 'Sellfox%')`);
    return { label, configured: true, ...rows[0] };
  } catch (error) {
    return { label, configured: true, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const sellfox = await inspect("MCP_PG_READONLY_URL（赛狐角色）", env.MCP_PG_READONLY_URL);
const amazon = await inspect("AMAZON_MCP_PG_READONLY_URL（Amazon 角色）", env.AMAZON_MCP_PG_READONLY_URL);
const violations = [];
if (sellfox.error || amazon.error) violations.push("只读连接不可用");
if (sellfox.amazon_tables_readable > 0) violations.push(`赛狐角色仍可读 ${sellfox.amazon_tables_readable} 张 Amazon* 表`);
if (amazon.configured && amazon.sellfox_tables_readable > 0) violations.push(`Amazon 角色仍可读 ${amazon.sellfox_tables_readable} 张 Sellfox* 表`);
if (!amazon.configured) violations.push("未配置 AMAZON_MCP_PG_READONLY_URL，Amazon 读路径仍走主连接");

console.log(JSON.stringify({ sellfox, amazon, violations,
  remediation: "执行 scripts/mcp-isolation/grant-roles.sql 后配置 AMAZON_MCP_PG_READONLY_URL，再复跑本脚本。",
  note: "应用层 assertProviderTable 前缀封闭清单始终生效；本审计只检查数据库角色层。" }, null, 2));
if (violations.some(item => item.includes("不可用"))) process.exitCode = 2;
else if (violations.length) process.exitCode = 1;

/** CLI 与状态端点共用唯一有效权限审计，不读取 .env。 */
import { pathToFileURL } from "node:url";
import { inspectDatabaseRoles } from "../../src/lib/mcp/database-audit.mjs";
export { auditQueries, evaluateAudit, inspectRole, rolePolicies } from "../../src/lib/mcp/database-audit.mjs";

export async function main(environment = process.env) {
  const result = await inspectDatabaseRoles(environment);
  console.log(JSON.stringify(result, null, 2));
  return !result.available ? 2 : result.violations.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

#!/usr/bin/env node
/** 离线输出唯一授权脚本；真实数据库执行由 DBA 在维护窗口负责。 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function main(args = process.argv.slice(2)) {
  if (args.length) {
    console.error("本入口仅支持无参数离线输出 SQL，不连接数据库。请 DBA 审阅 grant-roles.sql、完成 PUBLIC/成员/所有权等人工前置处理后，使用 psql -X -v ON_ERROR_STOP=1 -f scripts/mcp-isolation/grant-roles.sql 执行；再以 amazon_mcp_ro/sellfox_mcp_ro 各自连接运行 audit-roles.mjs。");
    return 2;
  }
  process.stdout.write(readFileSync(fileURLToPath(new URL("./grant-roles.sql", import.meta.url)), "utf8"));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();

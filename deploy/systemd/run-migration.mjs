#!/usr/bin/env node
/** 仅在已审批的 CI artifact 发布中运行；配置由唯一根 .env 显式注入。 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function migrationEnvironment(file, inherited = process.env) {
  const root = parseEnv(readFileSync(file, "utf8"));
  // 两个身份只取批准的根环境文件，不能由部署 shell 的同名变量覆盖。
  return { ...inherited, ...root, DATABASE_URL: root.DATABASE_URL, MIGRATION_DATABASE_URL: root.MIGRATION_DATABASE_URL };
}

export function runMigration(environment = process.env, run = spawnSync) {
  let migration;
  let runtime;
  try {
    migration = new URL(environment.MIGRATION_DATABASE_URL);
    runtime = new URL(environment.DATABASE_URL);
    if (![migration, runtime].every(url => ["postgres:", "postgresql:"].includes(url.protocol))) throw new Error();
    if (!migration.username || !runtime.username || migration.username === runtime.username) throw new Error();
    if (migration.host !== runtime.host || migration.pathname !== runtime.pathname) throw new Error();
  } catch {
    console.error("迁移需要根 .env 中独立 MIGRATION_DATABASE_URL；必须与应用登录不同，且指向同一主机和数据库。禁止回退应用凭证。");
    return 2;
  }
  const env = { ...environment, DATABASE_URL: environment.MIGRATION_DATABASE_URL, ERP_RUNTIME_MODE: "production", NODE_ENV: "production" };
  delete env.MIGRATION_DATABASE_URL;
  const result = run("npm", ["run", "db:migrate"], { env, stdio: "inherit", shell: false });
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    process.exitCode = runMigration(migrationEnvironment(process.argv[2]));
  } catch {
    console.error("无法读取指定根环境文件，迁移未执行。");
    process.exitCode = 2;
  }
}

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function validConnection(value, protocols) {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && Boolean(url.hostname) && !/^(REPLACE|GENERATE):/.test(value);
  } catch { return false; }
}

export function authReadiness(env) {
  let origin;
  try { origin = new URL(env.AUTH_PUBLIC_ORIGIN ?? ""); } catch { return { ok: false, detail: "AUTH_PUBLIC_ORIGIN 未配置或不是完整来源" }; }
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    return { ok: false, detail: "AUTH_PUBLIC_ORIGIN 只能包含协议、主机和端口" };
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (env.NODE_ENV !== "production") return { ok: true, detail: "非生产环境使用显式来源" };
  if (origin.protocol !== "https:" && !loopback) return { ok: false, detail: "生产公网 AUTH_PUBLIC_ORIGIN 必须使用 HTTPS" };
  if (!loopback && env.AUTH_TRUSTED_PROXY !== "caddy") return { ok: false, detail: "生产公网入口必须配置 AUTH_TRUSTED_PROXY=caddy" };
  return { ok: true, detail: loopback ? "生产隔离来源为 loopback，未启用可信代理" : "生产来源为 HTTPS 且使用 Caddy 可信代理" };
}

// Accept only byte-identical SQL or its LF/CRLF equivalents, as Prisma does.
export function migrationChecksums(sql) {
  const lf = Buffer.from(sql).toString("utf8").replace(/\r\n/g, "\n");
  return [...new Set([Buffer.from(sql), Buffer.from(lf), Buffer.from(lf.replace(/\n/g, "\r\n"))].map(value => createHash("sha256").update(value).digest("hex")))];
}

export function migrationCatalog(root) {
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => ({
    name: entry.name,
    checksum: createHash("sha256").update(readFileSync(path.join(root, entry.name, "migration.sql"))).digest("hex"),
    checksums: migrationChecksums(readFileSync(path.join(root, entry.name, "migration.sql"))),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function migrationReadiness(catalog, history) {
  const expected = new Map(catalog.map(row => [row.name, row.checksums ?? [row.checksum]]));
  const issues = [];
  for (const row of history) {
    if (!expected.has(row.migration_name)) issues.push(`目录外迁移：${row.migration_name}`);
    if (!row.finished_at && !row.rolled_back_at) issues.push(`未完成迁移：${row.migration_name}`);
    if (!row.rolled_back_at && expected.has(row.migration_name) && !expected.get(row.migration_name).includes(row.checksum)) issues.push(`校验和不一致：${row.migration_name}`);
  }
  for (const row of catalog) {
    const applied = history.filter(item => item.migration_name === row.name && item.finished_at && !item.rolled_back_at);
    if (applied.length !== 1) issues.push(`有效应用记录数 ${applied.length}：${row.name}`);
    else if (!Number.isSafeInteger(Number(applied[0].applied_steps_count)) || Number(applied[0].applied_steps_count) < 1) issues.push(`无有效执行步骤：${row.name}`);
  }
  return { ok: issues.length === 0 && catalog.length > 0, detail: `目录=${catalog.length} 历史=${history.length}${issues.length ? `；${issues.join("；")}` : "；名称/校验和/完成状态一致（不替代带数据迁移审核）"}` };
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function loopback(value) {
  try {
    const host = new URL(value ?? "").hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host);
  } catch {
    return null;
  }
}

export function productionEndpointStatus(value, { required = true, allowLoopback = false } = {}) {
  if (!value) return { ok: !required, detail: "未配置" };
  const local = loopback(value);
  if (local === null) return { ok: false, detail: "URL 无效" };
  if (local && !allowLoopback) return { ok: false, detail: "loopback 不符合生产拓扑" };
  return { ok: true, detail: local ? "目标机 Docker loopback" : "非 loopback" };
}

export function migrationCatalog(migrationsRoot) {
  if (!existsSync(migrationsRoot)) return [];
  return readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const sql = path.join(migrationsRoot, entry.name, "migration.sql");
      return { name: entry.name, hasSql: existsSync(sql) && readFileSync(sql, "utf8").trim().length > 0 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function migrationReadiness(migrationsRoot) {
  const catalog = migrationCatalog(migrationsRoot);
  return { ready: catalog.length > 0 && catalog.every(item => item.hasSql), catalog };
}

export function deploymentAssetStatus(root, relativePaths) {
  return relativePaths.every(relative => {
    const filename = path.join(root, relative);
    return existsSync(filename) && readFileSync(filename, "utf8").trim().length > 0;
  });
}

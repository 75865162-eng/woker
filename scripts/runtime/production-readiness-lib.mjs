import { createHash } from "node:crypto";
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

export function encryptionKeyStatus(value) {
  const encoded = String(value ?? "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return { ok: false, bytes: 0 };
  const decoded = Buffer.from(encoded, "base64");
  return { ok: decoded.length === 32 && decoded.toString("base64") === encoded, bytes: decoded.length };
}

/** Compare the prisma/migrations catalog and SQL checksums against history rows. */
export function migrationHistoryStatus(catalog, historyRows, migrationsRoot) {
  const rows = historyRows ?? [];
  const catalogNames = new Set(catalog.map(item => item.name));
  const unknown = rows.filter(row => !catalogNames.has(row.migration_name));
  const failed = rows.filter(row => !row.finished_at || row.rolled_back_at);
  const pending = catalog.filter(item => !rows.some(row => row.migration_name === item.name && row.finished_at && !row.rolled_back_at));
  const duplicates = catalog.filter(item => rows.filter(row => row.migration_name === item.name && row.finished_at && !row.rolled_back_at).length > 1);
  const noSteps = rows.filter(row => row.finished_at && !row.rolled_back_at && catalogNames.has(row.migration_name) && Number(row.applied_steps_count) < 1);
  const checksumDrift = migrationsRoot
    ? catalog.flatMap(item => {
      const row = rows.find(candidate => candidate.migration_name === item.name && candidate.finished_at && !candidate.rolled_back_at);
      if (!row || !item.hasSql) return [];
      const sql = readFileSync(path.join(migrationsRoot, item.name, "migration.sql"));
      const expected = createHash("sha256").update(sql).digest("hex");
      return row.checksum === expected ? [] : [item.name];
    })
    : [];
  const ok = failed.length === 0 && pending.length === 0 && unknown.length === 0 && duplicates.length === 0 && noSteps.length === 0 && checksumDrift.length === 0;
  const parts = [`已应用=${rows.filter(row => row.finished_at && !row.rolled_back_at && catalogNames.has(row.migration_name)).length}`];
  if (pending.length) parts.push(`未应用=${pending.map(item => item.name).join(", ")}`);
  if (failed.length) parts.push(`异常记录=${failed.map(row => row.migration_name).join(", ")}`);
  if (unknown.length) parts.push(`目录外记录=${unknown.map(row => row.migration_name).join(", ")}`);
  if (duplicates.length) parts.push(`重复有效记录=${duplicates.map(item => item.name).join(", ")}`);
  if (noSteps.length) parts.push(`无执行步骤=${noSteps.map(row => row.migration_name).join(", ")}`);
  if (checksumDrift.length) parts.push(`校验和不匹配=${checksumDrift.join(", ")}`);
  return { ok, detail: parts.join("；") };
}

export function deploymentAssetStatus(root, relativePaths) {
  return relativePaths.every(relative => {
    const filename = path.join(root, relative);
    return existsSync(filename) && readFileSync(filename, "utf8").trim().length > 0;
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const schema = readFileSync(new URL("prisma/schema.prisma", root), "utf8");
const migration = readFileSync(new URL("prisma/migrations/20261214130000_sellfox_ads_proposal/migration.sql", root), "utf8");

test("proposal native 类型与既有 SQL 一致，不转换存量时间", () => {
  const model = schema.match(/model SellfoxAdsProposal \{([\s\S]*?)\n\}/)![1];
  for (const field of ["createdAt", "updatedAt", "executedAt"]) {
    assert.match(model, new RegExp(`${field}\\s+DateTime\\??[^\\n]*@db\\.Timestamp\\(3\\)`));
    assert.match(migration, new RegExp(`"${field}" TIMESTAMP\\(3\\)`));
  }
  assert.match(model, /createdAt[^\n]*@default\(now\(\)\)/);
  assert.match(model, /updatedAt[^\n]*@updatedAt/);
});

for (const timezone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
  test(`已安装 adapter-pg 的真实转换函数在 ${timezone} 保持 epoch（非实库验收）`, () => {
    const source = readFileSync(require.resolve("@prisma/adapter-pg"), "utf8");
    const functions = ["mapArg", "formatDateTime", "normalize_timestamp"].map(name => {
      const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
      assert.ok(match, `缺少适配器函数 ${name}`);
      return match[0];
    }).join("\n");
    const code = `${functions}\nconst assert = require('node:assert/strict');
      for (const iso of ['2026-01-15T00:00:00.123Z', '2026-07-15T23:59:59.999Z', '2026-11-01T08:30:00.000Z']) {
        for (const dbType of ['TIMESTAMP', 'TIMESTAMPTZ']) {
          for (const value of [iso, new Date(iso)]) {
            const wire = mapArg(value, { scalarType: 'datetime', dbType, arity: 'scalar' });
            assert.equal(wire, iso.replace('T', ' ').replace(/(?:\\.000)?Z$/, ''));
            assert.equal(new Date(normalize_timestamp(wire)).getTime(), Date.parse(iso));
          }
        }
      }
      assert.equal(mapArg(null, {scalarType:'datetime'}), null);`;
    const result = spawnSync(process.execPath, ["-e", code], { env: { TZ: timezone, PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
}

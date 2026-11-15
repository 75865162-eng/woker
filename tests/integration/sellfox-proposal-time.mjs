import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";

// 仅由调用方提供本次隔离库的 pg.Pool；不读取环境、不创建连接池或生成客户端。
export async function verifySellfoxProposalTime(pool) {
  const adapter = await new PrismaPg(pool).connect();
  const tx = await adapter.startTransaction();
  const query = (sql, args = [], argTypes = []) => tx.queryRaw({ sql, args, argTypes });
  try {
    await query('CREATE TEMP TABLE sellfox_proposal_time ("createdAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3), "executedAt" TIMESTAMP(3)) ON COMMIT DROP');
    const dates = ["2026-01-15T00:00:00.123Z", "2026-07-15T23:59:59.999Z", "2026-11-01T08:30:00.000Z"];
    for (const zone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
      await query("SELECT set_config('TimeZone', $1, true)", [zone], [{ scalarType: "string", dbType: "TEXT", arity: "scalar" }]);
      for (const iso of dates) {
        for (const dbType of ["TIMESTAMP", "TIMESTAMPTZ"]) {
          // 同时覆盖对齐前后的 native 元数据；实际存储一直为 timestamp。
          const result = await query('INSERT INTO sellfox_proposal_time VALUES ($1, $2, $3) RETURNING "createdAt", "updatedAt", "executedAt"', [new Date(iso), iso, null], [
            { scalarType: "datetime", dbType, arity: "scalar" },
            { scalarType: "datetime", dbType, arity: "scalar" },
            { scalarType: "datetime", dbType, arity: "scalar" },
          ]);
          assert.equal(new Date(result.rows[0][0]).getTime(), Date.parse(iso));
          assert.equal(new Date(result.rows[0][1]).getTime(), Date.parse(iso));
          assert.equal(result.rows[0][2], null);
          const executed = await query('UPDATE sellfox_proposal_time SET "executedAt" = $1 RETURNING "executedAt"', [iso], [{ scalarType: "datetime", dbType, arity: "scalar" }]);
          for (const row of executed.rows) assert.equal(new Date(row[0]).getTime(), Date.parse(iso));
        }
      }
    }
  } finally {
    try { await query("ROLLBACK"); } finally { await tx.rollback(); await adapter.dispose(); }
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const stripComments = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("restock reader uses latest materialized snapshot, not strict same-day version equality", () => {
  const source = stripComments(readFileSync(path.join(root, "src/lib/sellfox/restock-read.ts"), "utf8"));
  // Must fetch the most recent materialized snapshot across days.
  assert.ok(/findFirst\(\{[\s\S]*?orderBy:\s*\[\{\s*inputDate:\s*"desc"/.test(source),
    "应查最近一期物化快照（inputDate desc）而非 inputDate === today 的精确匹配");
  // Must NOT gate on inputVersion === currentVersion (that caused permanent live fallback / 13s).
  assert.ok(!/snapshot\.inputVersion\s*===\s*currentVersion/.test(source),
    "不得再要求 inputVersion 严格等于当前库存版本（每3h同步会让其几乎永不成立）");
  // Must expose data-age so the UI can label freshness.
  assert.ok(/snapshotAgeHours/.test(source), "应随响应返回快照时效供前端标注");
  // Must still fall back to live when no snapshot exists.
  assert.ok(/readThroughSellfox\(/.test(source) && /\(\)\s*=>\s*readSellfoxRestock\(query, scope, storeIds, today\)/.test(source),
    "快照缺失时应透明回退 live 全量重算（readThroughSellfox 的 load 回调仍是 readSellfoxRestock）");
});

test("restock route defaults to materialized and keeps explicit live escape hatch", () => {
  const source = stripComments(readFileSync(path.join(root, "src/app/api/sellfox/restock/route.ts"), "utf8"));
  assert.ok(/searchParams\.get\("source"\)\s*===\s*"live"\s*\?\s*"live"\s*:\s*"materialized"/.test(source),
    "默认 materialized，显式 source=live 才走实时重算");
});

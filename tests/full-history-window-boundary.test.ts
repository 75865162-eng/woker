import assert from "node:assert/strict";
import test from "node:test";
import { SELLFOX_FULL_HISTORY_DAYS, getSellfoxWindowConfig } from "@/lib/sellfox/window-config";
import { sellfoxDateChunks, sellfoxSpanDays } from "@/lib/sellfox/sync-rules";
import { planSellfoxSalesBackfill } from "@/lib/sellfox/backfill-plan";
import { defaultSellfoxBackfillStart } from "@/lib/sellfox/schedule-time";
import { financeRetentionFloor } from "@/lib/amazon-sync/finance";
import { automaticBackfillDays, automaticInventoryEventBackfillDays, automaticReportDiscoveryDays } from "@/lib/amazon-sync/automatic-window-rules";

/**
 * 本次改造的契约边界：
 * - 系统自设的"往回拉多久"天花板一律放开（能拉尽拉）；
 * - 官方 API 硬约束（保留期 / 单次跨度 / 分页安全机制）一律保留。
 * 这组测试锁定边界，防止后续把官方约束误删或把系统限制改回去。
 */
test("系统自设的赛狐回溯天花板已放开到全量历史", () => {
  const cfg = getSellfoxWindowConfig();
  assert.ok(SELLFOX_FULL_HISTORY_DAYS >= 20 * 365, "默认至少覆盖 20 年历史");
  assert.equal(cfg.maxReportDays, SELLFOX_FULL_HISTORY_DAYS);
  assert.equal(cfg.backfillDaysPerRun, 365);

  // 原本 90 天 bootstrap / 三年补数 / 3650 天总跨度都已放开。
  const start = defaultSellfoxBackfillStart(new Date("2026-10-25T00:00:00Z"));
  assert.ok(sellfoxSpanDays(start, "2026-10-24") > 3650, "回填起点跨度超过旧的 3650 天上限");
  const chunks = sellfoxDateChunks("2010-01-01", "2026-10-24", 365);
  assert.ok(chunks.length > 10, "长历史可切成多个 365 天块");
  assert.ok(chunks.every(c => sellfoxSpanDays(c.startDate, c.endDate) <= 365));
  const units = planSellfoxSalesBackfill({ startDate: "2010-01-01", endDate: "2026-10-24", chunkDays: 365, shopExternalIds: ["s1"], coverage: [] });
  assert.ok(units.length > 10, "超三年补数现在合法");
});

test("官方硬约束仍保留，未被'全量'误删", () => {
  // Amazon 财务滚动两年保留期（官方）仍在。
  const now = new Date("2026-11-22T00:00:00Z");
  const floor = financeRetentionFloor(now);
  assert.equal(floor.getUTCFullYear(), 2024);
  assert.ok(now.getTime() - floor.getTime() > 600 * 86_400_000, "保留期约为两年");

  // getReports 90 天发现窗口、库存 18 个月、销售流量两年历史（均为官方天花板）未改动。
  assert.equal(automaticReportDiscoveryDays, 90);
  assert.equal(automaticInventoryEventBackfillDays, 540);
  assert.equal(automaticBackfillDays, 730);

  // 赛狐分页安全机制仍在（数值放宽，机制不删）。
  assert.ok(getSellfoxWindowConfig().maxPages >= 100_000);
});

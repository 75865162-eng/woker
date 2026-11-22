import assert from "node:assert/strict";
import test from "node:test";
import { describeSellfoxResourceWindow, getSellfoxWindowConfig, SELLFOX_FULL_HISTORY_DAYS } from "@/lib/sellfox/window-config";

const keys = ["SELLFOX_MAX_REPORT_DAYS", "SELLFOX_HOURLY_LOOKBACK_DAYS", "SELLFOX_MAX_PAGES_PER_RESOURCE", "SELLFOX_BACKFILL_DAYS_PER_RUN"] as const;

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const k of keys) {
      const v = saved[k];
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test("系统自设的天花板已放开为全量历史", () => {
  withEnv({}, () => {
    const cfg = getSellfoxWindowConfig();
    assert.equal(cfg.maxReportDays, SELLFOX_FULL_HISTORY_DAYS, "单次跨度不再被 90 天自设限制卡住");
    assert.equal(cfg.hourlyLookbackDays, SELLFOX_FULL_HISTORY_DAYS, "小时样本回溯不再被 60 天自设限制卡住");
    assert.equal(cfg.backfillDaysPerRun, 365, "每轮回填从 7 天放开到 365 天");
    assert.equal(cfg.maxPages, 100_000, "分页安全上限放宽（机制保留）");
  });
});

test("窗口可用环境变量覆盖，改而不发版", () => {
  withEnv({ SELLFOX_MAX_REPORT_DAYS: "30", SELLFOX_BACKFILL_DAYS_PER_RUN: "14" }, () => {
    const cfg = getSellfoxWindowConfig();
    assert.equal(cfg.maxReportDays, 30);
    assert.equal(cfg.backfillDaysPerRun, 14);
  });
});

test("配置 fail-closed：超上限被夹到全量历史上限，非法值回退默认，绝不越过上限", () => {
  withEnv({ SELLFOX_MAX_REPORT_DAYS: "999999", SELLFOX_MAX_PAGES_PER_RESOURCE: "9999999", SELLFOX_HOURLY_LOOKBACK_DAYS: "abc" }, () => {
    const cfg = getSellfoxWindowConfig();
    assert.equal(cfg.maxReportDays, SELLFOX_FULL_HISTORY_DAYS);
    assert.equal(cfg.maxPages, 1_000_000);
    assert.equal(cfg.hourlyLookbackDays, SELLFOX_FULL_HISTORY_DAYS);
  });
});

test("按资源类型描述窗口，反映放开后的全量历史语义", () => {
  withEnv({}, () => {
    assert.equal(describeSellfoxResourceWindow("inventory"), "仅当前状态");
    assert.equal(describeSellfoxResourceWindow("stores"), "无日期窗口");
    assert.equal(describeSellfoxResourceWindow("hourly"), `最近 ${SELLFOX_FULL_HISTORY_DAYS} 天单日`);
    assert.equal(describeSellfoxResourceWindow("sales"), `最多 ${SELLFOX_FULL_HISTORY_DAYS} 个自然日`);
  });
});

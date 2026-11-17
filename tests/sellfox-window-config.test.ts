import assert from "node:assert/strict";
import test from "node:test";
import { describeSellfoxResourceWindow, getSellfoxWindowConfig } from "@/lib/sellfox/window-config";

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

test("默认窗口值与现有硬编码一致（兼容既有语义）", () => {
  withEnv({}, () => {
    assert.deepEqual(getSellfoxWindowConfig(), {
      maxReportDays: 90,
      hourlyLookbackDays: 60,
      maxPages: 10_000,
      backfillDaysPerRun: 7,
    });
  });
});

test("窗口可用环境变量覆盖，改而不发版", () => {
  withEnv({ SELLFOX_MAX_REPORT_DAYS: "30", SELLFOX_BACKFILL_DAYS_PER_RUN: "14" }, () => {
    const cfg = getSellfoxWindowConfig();
    assert.equal(cfg.maxReportDays, 30);
    assert.equal(cfg.backfillDaysPerRun, 14);
  });
});

test("配置 fail-closed：超上限被夹到上限，非法值回退默认，绝不放大防护", () => {
  withEnv({ SELLFOX_MAX_REPORT_DAYS: "9999", SELLFOX_MAX_PAGES_PER_RESOURCE: "50000", SELLFOX_HOURLY_LOOKBACK_DAYS: "abc" }, () => {
    const cfg = getSellfoxWindowConfig();
    assert.equal(cfg.maxReportDays, 90);
    assert.equal(cfg.maxPages, 10_000);
    assert.equal(cfg.hourlyLookbackDays, 60);
  });
});

test("按资源类型描述窗口，便于接入配置核对", () => {
  withEnv({}, () => {
    assert.equal(describeSellfoxResourceWindow("inventory"), "仅当前状态");
    assert.equal(describeSellfoxResourceWindow("stores"), "无日期窗口");
    assert.equal(describeSellfoxResourceWindow("hourly"), "最近 60 天单日");
    assert.equal(describeSellfoxResourceWindow("sales"), "最多 90 个自然日");
  });
});

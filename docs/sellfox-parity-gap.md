# Sellfox parity gap — TK店-US (124687) — updated 2026-10-29 (Asia/Shanghai)

Constraints: BOX ONLY (no push / deploy / SSH). Fee-mining paused. Gold from browser capture 2026-10-29.

## Gold

### 销量统计 (ASIN, 按ASIN汇总 ON, 按日, 原币种)
- Window: **2026-09-29 ~ 2026-10-28**
- 小计销量 **4,793** | FBA可售 **11,891** | FBA总库存 **18,204**
- Daily qty: 10-28 **71**, 10-27 **139**, 10-26 **131**, 10-25 **138**, 10-24 **167**, 10-23 **148**, 10-22 **118**

### 销售利润 (订购时间, ASIN, 按ASIN汇总 OFF, 只统计已结算 OFF)
- Window: **2026-09-30 ~ 2026-10-29**
- 毛利润 **US$14,729.70** (13.09%) | 净销售额毛利率 13.98%
- 销售额 **US$112,504.08** | 净销售额 **US$105,327.62**
- 订单量 **4,187** | 销量 **4,644** | 退款量 **292** (6.29%) | 退款 **US$-5,680.75**
- 广告订单 **1,982** (47.34%) | 广告销售额 **US$51,521.06** | 广告花费 **US$-11,990.27** (10.66%)
- 采购成本 **US$-21,203.22** | 头程 **US$-7,243.10** | 促销折扣 **US$-8,094.73**

## Local ERP (127.0.0.1:3000)

### 销量统计 — matches / deltas
| Metric | Local (09-29~10-28) | Gold | Delta |
|---|---:|---:|---:|
| 销量 qty | **4,584** | 4,793 | **-209** |
| 销售额 revenue | **$110,643.39** | (not on volume page; profit gold sales $112,504.08) | n/a vs volume gold |
| 订单 orderNum (DB sum) | **4,132** | (profit gold orders 4,187) | see profit |
| Days with rows | **29** (09-29..10-27) | 30 | **missing 2026-10-28 entirely** |

Daily qty residual vs gold (from-123 matrix import):

| Date | Local | Gold | Delta |
|---|---:|---:|---:|
| 10-22 | 118 | 118 | 0 |
| 10-23 | **149** | 148 | **+1** |
| 10-24 | 167 | 167 | 0 |
| 10-25 | **119** | 138 | **-19** |
| 10-26 | **70** | 131 | **-61** |
| 10-27 | **79** | 139 | **-60** |
| 10-28 | **0 (missing)** | 71 | **-71** |
| **Sum of day deltas above** | | | **−210** (~matches −209 window; +1 on 10-23) |

**Root cause:** from-123 export matrix under-counts late days vs live Sellfox; no ASIN-level file for 10-28 on disk. Cannot invent ASIN rows. Need fresh Sellfox/123 销量统计按日 matrix for 09-29~10-28 (or at least 10-25~10-28).

Inventory spot (listings/FBA snapshots, not sales page):
| Source | FBA可售 / fulfillable | FBA总库存 |
|---|---:|---:|
| Gold | 11,891 | 18,204 |
| Local listings (capturedAt 2026-10-28, after primaryMsku collapse 526→261 keys) | **3,535** | — |
| Local FbaInventorySnapshot | qty **3,580** / totalInventory **5,712** | under gold |
| from-123 CSV raw before collapse | fulfillable **12,026** | — |

Listings import collapses multi-MSKU rows → understates fulfillable. Separate fix; not invented this turn.

### 销售利润 — matches / deltas

**Available local data (not gold window daily):**
1. **Window ASIN xlsx** parked as `reportDate=2026-10-21` only: Sellfox export `TK店-US_销售利润_ASIN_2026-09-22_2026-10-21.xlsx` (window **09-22~10-21**, 105 ASINs). Fees now project correctly via payload top-level keys (trigger `sellfox_product_daily_project_write`).
2. **Daily CSV** `TK店-US_performance_2026-09-29_2026-10-28.csv`: real days **only 10-24 & 10-25** (filename misleading). Fee columns mostly empty in CSV → purchase/headtrip 0 on those days.

| KPI | Local window park **from=to=2026-10-21** | Gold 09-30~10-29 | Notes |
|---|---:|---:|---|
| 销量 | **4,706** | 4,644 | Different window (xlsx ends 10-21; gold through 10-29) |
| 销售额 | **$110,347.14** | $112,504.08 | Δ ≈ −$2,157 |
| 净销售额 | **$104,227.71** | $105,327.62 | Δ ≈ −$1,100 |
| 毛利润 | **$14,868.96** | $14,729.70 | Δ ≈ +$139 |
| 广告花费 | **−$12,519.33** | −$11,990.27 | Δ ≈ −$529 |
| 采购成本 | **−$20,384.87** | −$21,203.22 | Δ ≈ +$818 |
| 头程 | **−$7,066.66** | −$7,243.10 | Δ ≈ +$176 |
| 促销折扣 | **−$7,053.38** | −$8,094.73 | Δ ≈ +$1,041 |
| 退款额 | **−$5,509.31** | −$5,680.75 | Δ ≈ +$171 |
| 退款量 | **283** | 292 | Δ −9 |
| 订单量 | **null in API** (xlsx lacked 订单量 col / not mapped) | 4,187 | **blocker for order KPI** |

**Do NOT query performance `from=2026-09-30&to=2026-10-29` for gold compare** — that sums window blob (10-21) + daily CSV (10-24/25) → qty 4,960 / rev $116,927 (double-count style inflate). Spot-check window export with **from=to=2026-10-21** only.

## Live sync blockers
1. **Sellfox OpenAPI** `openapi.sellfox.com` from box: **ECONNRESET / timeout** (www.sellfox.com OK). Cannot live-sync performance via OpenAPI.
2. **Browser cookie pull**: executor has no Computer/browser dispatch; parent must capture session or user provides export.
3. **123.207.47.225**: HTTP login-walled; no SSH allowed; existing from-123 dumps already ingested and under-count late sales days vs gold.
4. Fee-mining still **paused** — mapped export keys only; no new fee invention.

## Exact files / API still needed for gold align
1. Sellfox **销售利润** export: 订购时间 **2026-09-30 ~ 2026-10-29**, ASIN, 按ASIN汇总 **OFF**, 只统计已结算 **OFF** (same Chinese columns as prior xlsx). Prefer daily or same-window ASIN file matching gold KPIs.
2. Sellfox or 123 **销量统计** 按日 matrix including **2026-10-28** and corrected **10-25~10-27** (ASIN × day) so qty → 4,793.
3. Optional: fix listings import to sum fulfillable across sibling MSKUs instead of primary-key collapse (raw CSV already ~12,026 ≈ gold 11,891).

## How to open (local)
- App: http://127.0.0.1:3000  
- Login: email `1` / password = `BOOTSTRAP_ADMIN_PASSWORD` in repo `.env`
- 销量统计 (gold window): http://127.0.0.1:3000/sellfox?domain=sales&from=2026-09-29&to=2026-10-28&shopExternalId=124687&sortBy=subtotal&sortOrder=desc
- 销售利润 (window export spot-check ONLY): http://127.0.0.1:3000/sellfox?domain=performance&from=2026-10-21&to=2026-10-21&shopExternalId=124687&sortBy=saleRevenue&sortOrder=desc
- Daily CSV days: http://127.0.0.1:3000/sellfox?domain=performance&from=2026-10-24&to=2026-10-25&shopExternalId=124687&sortBy=saleRevenue&sortOrder=desc

## Scripts touched this pass
- `scripts/local/import-tk-us-profit-window.mjs` — fee keys written to payload top-level so DB trigger fills typed fee columns; re-import OK (purchase/headtrip/refund/shipping/commission non-null on 10-21).
- `scripts/local/import-tk-us-sales-performance.mjs` — prefers CSV `sourceKey` (prior).
- JSON park: `/workspace/sellfox-exports/2026-10-28/from-123/TK店-US_销售利润_ASIN_window-2026-09-22_2026-10-21.json`

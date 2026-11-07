# Sellfox 六页 1:1 复刻设计（box-only / read-only）

- Repo: `/workspace/amazon-ad-bulk-operation` · branch `codex/amazon-multistore-mcp` · HEAD `9d7d222`
- Scope: 销售→在线产品 / 订单→全部订单 / FBA→货件 / FBA→补货建议 / 数据→销量统计 / 数据→销售利润
- Constraint: data from existing `amazon_bulk_ad` Sellfox* tables only when present; no invent; typography JSON TBD → apply as one global token set.

## 0. Current baseline (do not rewrite blindly)

| Sellfox menu | Local today | Table | API |
|---|---|---|---|
| 销售→在线产品 | `/sellfox?domain=listings` | `SellfoxListingSnapshot` | `GET /api/sellfox/listings` via `src/app/api/sellfox/[domain]/route.ts` → `workbench-read.ts` |
| 订单→全部订单 | **missing** | none (only SP-API `AmazonOrderRecord`) | none |
| FBA→货件 | **missing** | none | OpenAPI `/api/fba/shippingOrder/pageList.json` known in `/tmp/sellfox-mcp/endpoint-specs.ts` |
| FBA→补货建议 | **missing** (CSV scrapes only) | none | no OpenAPI tool; scrapes in `/workspace/sellfox-exports/*补货*` |
| 数据→销量统计 | `/sellfox?domain=sales` | `SellfoxSalesDailySnapshot` (+ join FBA qty) | `GET /api/sellfox/sales` + `[domain]` |
| 数据→销售利润 | `/sellfox?domain=performance` | `SellfoxProductDailySnapshot` | `GET /api/sellfox/performance` |

Shell: `src/app/sellfox/page.tsx` → `SellfoxWorkbench` (`src/components/sellfox/sellfox-workbench.tsx`). Domains in `src/lib/sellfox/workbench-view.ts` `sellfoxDomains`.

## 1. Routes (Next.js App Router)

Keep **one workbench shell**; add nested pages for deep-link + IA parity. Query `domain=` stays canonical for existing clients.

| Route | Maps to | Edit / add |
|---|---|---|
| `src/app/sellfox/page.tsx` | redirect default → `?domain=sales` or keep overview | **edit** title/subtitle |
| `src/app/sellfox/layout.tsx` | wrap with `.sellfox-ui` + typography tokens | **add** |
| `src/app/sellfox/listings/page.tsx` | 在线产品 → render workbench `domain=listings` | **add** (thin) |
| `src/app/sellfox/orders/page.tsx` | 全部订单 | **add** (thin; grey until sync) |
| `src/app/sellfox/shipments/page.tsx` | FBA 货件 | **add** |
| `src/app/sellfox/restock/page.tsx` | FBA 补货建议 | **add** |
| `src/app/sellfox/sales/page.tsx` | 销量统计 | **add** |
| `src/app/sellfox/performance/page.tsx` | 销售利润 | **add** |

Also extend `sellfoxDomains` in `src/lib/sellfox/workbench-view.ts`:
`orders`, `shipments`, `restock` (ids). Update `src/components/sellfox/domain-tabs.tsx` labels to match Sellfox IA (销售/订单/FBA/数据 grouping optional later).

## 2. Components (new + reuse)

**Reuse (restyle, don’t fork logic):**
- `src/components/sellfox/sellfox-workbench.tsx` — orchestrator
- `src/components/sellfox/browse-filters.tsx` — filters / date shortcuts / dims
- `src/components/sellfox/resource-table.tsx` — table + footer pager
- `src/components/sellfox/connection-bar.tsx` — shop filter
- `src/components/sellfox/workbench-types.ts` — column defs / `unavailableReason`

**Add under `src/components/sellfox/ui/` (Sellfox-pixel shell):**
| File | Role |
|---|---|
| `sellfox-shell.tsx` | page chrome: left IA (optional), top tabs, white card |
| `sellfox-filter-bar.tsx` | shared filter row (site/shop/search/status) |
| `sellfox-date-presets.tsx` | presets: 今天/昨天/近7/近14/近30/近90/本月/上月/自定义；emit `{from,to,allDates}` via `sellfoxDateAt` |
| `sellfox-column-picker.tsx` | 自定义列 modal; persist keys (reuse `columnSelection` localStorage pattern in workbench) |
| `sellfox-paginator.tsx` | 「第 n 页 / 共 N 条」+ pageSize 20/50/100 matching Sellfox |
| `sellfox-metric-tabs.tsx` | 销量/订单量/销售额 (sales only) |
| `sellfox-dimension-tabs.tsx` | ASIN/父ASIN/MSKU/SKU/店铺/开发员… |
| `sellfox-locked-control.tsx` | grey lock + title reason (existing pattern) |
| `pages/listings-page.tsx` | 在线产品 layout (子体/父体 tab; 父体 locked until verified) |
| `pages/orders-page.tsx` | 全部订单 layout |
| `pages/shipments-page.tsx` | 货件 layout |
| `pages/restock-page.tsx` | 补货建议 layout |
| `pages/sales-page.tsx` | 销量统计 (wide/matrix) |
| `pages/performance-page.tsx` | 销售利润 (onlySettle / currency) |

Typography: all new UI under `.sellfox-ui` so tokens don’t leak into AppShell.

## 3. API routes

| Endpoint | Source | File |
|---|---|---|
| `GET /api/sellfox/listings` | existing | `[domain]/route.ts` + `workbench-read.ts` |
| `GET /api/sellfox/sales` | existing | `src/app/api/sellfox/sales/route.ts` |
| `GET /api/sellfox/performance` | existing | `src/app/api/sellfox/performance/route.ts` |
| `GET /api/sellfox/performance/export` | existing | `.../performance/export/route.ts` |
| `GET /api/sellfox/orders` | **new** | `src/app/api/sellfox/orders/route.ts` |
| `GET /api/sellfox/shipments` | **new** | `src/app/api/sellfox/shipments/route.ts` |
| `GET /api/sellfox/restock` | **new** | `src/app/api/sellfox/restock/route.ts` |
| export siblings | mirror `.../[domain]/export/route.ts` | add when table exists |

Shared: `requireApiPermission("sellfox","view")`, `workspaceScopeFromRequest`, `sellfoxBrowseStoreIds`, `sellfoxBrowseQuery` (`src/lib/sellfox/browse-query.ts`).

Extend `domains` array in `[domain]/route.ts` **or** keep dedicated routes for the three new domains (preferred until contracts stable).

Lib readers to add:
- `src/lib/sellfox/orders-read.ts`
- `src/lib/sellfox/shipments-read.ts`
- `src/lib/sellfox/restock-read.ts`

Sync (later, not UI-only): extend `sellfoxSyncResources` in `src/lib/sellfox/sync-contract.ts` + workers in `sync-service.ts` / `snapshot-sync.ts`.

## 4. Data flow (table → page)

```
SellfoxStore ─────────────────┬── shop/site facets (all pages)
SellfoxListingSnapshot ───────┼── listings (latest capturedAt per store+sourceKey)
SellfoxSalesDailySnapshot ────┼── sales (group by dim; date from..to; join latest FBA qty)
SellfoxProductDailySnapshot ──┼── performance (onlySettle, currency, fee cols)
SellfoxFbaInventorySnapshot ──┼── sales inventory cols + restock inputs (qty/inTransit)
SellfoxAds*Daily ─────────────┴── performance adCost / ads page (out of 6)

NEW (blocked until sync):
SellfoxOrderSnapshot     ← OpenAPI order pageList (TBD exact path; FBM-only exists today)
SellfoxShipmentSnapshot  ← /api/fba/shippingOrder/pageList.json (+ batch optional)
SellfoxRestockSnapshot   ← no OpenAPI; browser scrape or derived from listings+sales+FBA
```

**Joins / filters (reuse):**
- Shop scope: `sellfoxBrowseStoreIds` + `SellfoxStore.externalId`
- Listings current page: index `sellfox_listing_current_page` (storeId, capturedAt)
- Sales: unique `(storeId, reportDate, sourceKey)`; dim = asin|parentAsin|msku|sku|store|…
- Performance: unique `(storeId, reportDate, sourceKey, onlySettle)`
- Date: `sellfoxDateAt` Asia/Shanghai; sales/performance reject >90d sync windows (UI may still query local longer)

## 5. Font / typography tokens

Await user Sellfox typography JSON. Apply once under `.sellfox-ui` in `src/app/sellfox/layout.tsx` + `src/app/globals.css`:

```css
.sellfox-ui {
  --sf-font: /* from JSON, fallback PingFang SC / Microsoft YaHei */;
  --sf-body: …px;           /* page body */
  --sf-filter-label: …px;   /* 筛选 label — today text-[11px] */
  --sf-control: …px;        /* inputs/selects — today text-xs */
  --sf-tab: …px;            /* domain / dim tabs */
  --sf-th: …px;             /* table header */
  --sf-td: …px;             /* table body */
  --sf-btn: …px;            /* primary/secondary buttons */
  --sf-total: …px;          /* footer 小计 / KPI */
  --sf-page: …px;           /* paginator */
  --sf-weight-regular: 400;
  --sf-weight-medium: 500;
  --sf-weight-semibold: 600;
  font-family: var(--sf-font);
}
```

Map Tailwind utilities used in sellfox components → CSS vars (or replace `text-xs`/`text-[11px]` with a concrete variable, for example `text-[length:var(--sf-filter-label)]`). Tailwind scans this document too, so examples must use valid CSS variable names rather than wildcard placeholders. **Do not** change global AppShell fonts. Until JSON arrives, keep current sizes but wire the vars so drop-in is one file edit: `src/styles/sellfox-tokens.css` (add) imported by sellfox layout.

## 6. Risk / blockers (no invented data)

| Page | Blocker | Mitigation |
|---|---|---|
| 在线产品 | Mostly ready; 父体 / some cols grey | Keep locked controls; no fake parent rows |
| 销量统计 | Parity gaps vs live Sellfox (see `/workspace/sellfox-parity-gap.md`) | UI 1:1 OK; numbers follow local sync; don’t invent ASIN days |
| 销售利润 | Fee cols depend on sync payload projection | Use typed cols only; null ≠ 0 |
| 全部订单 | **No Sellfox order table**; MCP only has FBM `getPackagePage`; “全部订单” needs full order API + sync | Ship UI shell + empty/locked; add `SellfoxOrderSnapshot` + sync resource before enabling |
| 货件 | **No table**; API known | New model + sync from `shippingOrder/pageList`; UI grey until first successful sync |
| 补货建议 | **No OpenAPI**; only scrape CSVs | Option A: new sync via browser/export ingest → `SellfoxRestockSnapshot`; Option B: **derived** view from `Listing + SalesDaily + FbaInventory` (label as 本地推算, not 赛狐原页) until API found |
| Typography | JSON not yet provided | Token file stubbed; apply when JSON lands |
| 1:1 pixel | Need live DOM/screenshots (in progress on box) | Freeze filter/button inventory from captures before coding each page |

## 7. Build order (suggested)

1. Tokens + `sellfox/layout.tsx` + extract `sellfox-date-presets` / `paginator` / `column-picker`
2. Restyle existing **sales + performance + listings** to tokenized shell (biggest bang; data ready)
3. Add route stubs + grey **orders / shipments / restock** pages
4. Prisma models + sync for shipments (API clear) → enable shipments UI
5. Decide restock: scrape ingest vs derived; orders: confirm OpenAPI for 全部订单
6. Pixel pass against Sellfox screenshots (font sizes last once JSON in)

## 8. Out of scope this design

- Push / deploy / 123 edits
- Inventing rows for missing sync
- Ads / overview / runs redesign
- Changing Sellfox sync worker schedule

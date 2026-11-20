# 赛狐对齐总规划 v4 — 执行拆解（落到文件 / 函数 / 迁移 / 测试）

> 日期：2026-11-20　基线 commit：`8d3d245`
> 依据：用户上传的 `sellfox-parity-plan-v4 (1).md`，并逐条比对当前代码现状后拆解。
> 本文只做执行拆解，不改代码。每段独立可验收，按 M0→M4 顺序推进。

## 0. 现状核对结论（与 v4 文档的偏差校正）

拆解前逐文件核对，以下几处文档描述与当前代码**不一致**，直接影响工作量与做法：

| 文档断言 | 代码实际（基线 `8d3d245`） | 影响 |
|---|---|---|
| D2 父ASIN / D5 SPU / D7 开发员「聚合键缺失/来源未定」 | `workbench-read.ts:161` 已通过 join `l.parentAsin` / `l.spu` / `COALESCE(l.developer,'未分配开发员')` 实现；`identity`（:162）已处理 parentAsin；`sellfoxCrossStoreGrain`（:42）已覆盖 parentAsin/spu/developer | 这 3 个维度**不是新增功能，而是补测试与列默认值**，成本大幅下降 |
| M4「无前往页码」 | `replica-workbench.tsx:808-820` 已有「前往页码」输入（Enter/Blur 提交） | 只需补越界夹取提示，不需新做 |
| 库存「FBA在途/入库/不可售/预留 缺」 | `SellfoxFbaInventorySnapshot` 已有 `inTransit/inboundWorking/inboundShipped/inboundReceiving/unfulfillable/reservedTransfer/reservedProcessing/reservedCustomerorders` | 主要是**列渲染 + 聚合映射**，非加字段 |
| F4「公共/个人标签需新建表」 | `SellfoxProductTag` 表确实不存在；但 `listing.openDate` 字段存在（生命周期 4 档可纯 SQL） | 生命周期档可一期落地，标签 2 档仍二期 |
| `field-registry.ts` 要新建 | 仅存在 `src/lib/amazon-sync/field-registry.ts`（Amazon 用），sellfox 版确实没有 | M0 新建路径明确 |

确认无误的现状：`replica-pages.ts` 440 行、`replica-workbench.tsx` 863 行、`browse-query.ts` 183 行、`workbench-read.ts` 462 行、`browse-grain.ts` 157 行；默认维度 `msku`；业务员维度 `disabled`；站点/店铺为单值 `<select>`；`SITE_REGIONS` 在 `replica-workbench.tsx:72`。**文档整体可信，仅上述偏差需修正。**

---

## M0 — 数据契约（约 3 人日，可独立验收）

**目标**：所有赛狐字段有明确落点；缺失显式 `null`，不用 UI 占位冒充。

### 交付物与落地位置

1. **新建 `src/lib/sellfox/field-registry.ts`**
   - 结构：`Record<FieldKey, { source: 'snapshot'|'listing'|'inventory'; table; column; aggregate; nullSemantics: '-'|'未分配…'; enabled: boolean; reason? }>`
   - 覆盖 v4 §4.1–4.4 全部字段（8 维度 + 17 基本列 + 14 库存列 + 3 销售列）。
   - 关键：`null` 语义统一为 UI「-」；不补 0；跨币种不相加；除零返回 null。

2. **迁移（新建 1 个 migration 目录，非 3 个——见下方说明）**
   - 文档说「3 个迁移」，但按当前 schema 只需补真实缺口：
     - `SellfoxSalesDailySnapshot` 加 `businessOwnerId String?` + `businessOwnerName String?`（D8/F5）。
     - 若 F6 业绩归属人要独立于业务员：`perfOwnerId String?` + `perfOwnerName String?`。
     - 型号 `model String?` 若 `listing` 侧无字段则加在 listing（当前 listing 无 `model`，需确认 sync 源）。
   - **不需要加** parentAsin/spu/developer 到销售表（已从 listing join）。
   - 索引：`@@index([organizationId, workspaceId, businessOwnerId])`。

3. **同步侧写入**：`src/lib/sellfox/snapshot-sync.ts`（及 `sync-shards.ts` 如分片写同一表）写入新列；来源缺失时写 `null`，不写 0/空串冒充。

### 测试
- 新建 `tests/sellfox-field-registry.test.ts`：断言每个字段 registry 项有 source/column/nullSemantics；断言无字段把 `null` 映射为 0。
- 新建 `tests/integration/sellfox-business-owner-migration.ts`（PGlite）：验证新列可空、索引存在、旧行回填为 null。

### 验收断言
- 任一列可回答「来自哪张表哪个字段、怎么聚合、空值表示什么」。
- 迁移后旧数据新列为 `null`，不是 0。

---

## M1 — 筛选语法（约 8 人日，可独立验收）

**目标**：站点/店铺/标签/人员四类多维筛选真正生效，参数可组合、可回填、可分享。

### 交付物与落地位置

1. **新建 `src/lib/sellfox/filter-codec.ts`**
   - `encodeFilters(Filters): URLSearchParams` / `decodeFilters(searchParams): Filters`。
   - 多值语法：`site=US,CA`、`shopExternalId` 沿用现有 `getAll`（已支持数组），`businessOwnerId=A,B`、`perfOwnerId=A,B`。
   - 与 `browse-query.ts` 现有参数**双向兼容**（旧单值 URL 仍可读）。

2. **扩展 `src/lib/sellfox/browse-query.ts`**
   - `site`：`string` → `string[]`（逗号切分，加白名单校验，非法站点 400）。
   - 新增 `businessOwnerIds[]` / `perfOwnerIds[]`（含 `NULL` 哨兵表示「无业务员」）。
   - `searchType` 补 `spu/styleName/model/productName` 4 个维度（:140 白名单）。
   - 批量搜索：`search` 支持换行/逗号切分 → `IN`，上限 200，超出抛 `SellfoxBrowseError(413)`。

3. **扩展 where 构造（同文件 :152-163）**
   - `sellfoxStoreWhere` / `sellfoxSnapshotWhere`：`site` 由 `= query.site` 改 `in: query.sites`；`SellfoxStore.marketplace in`。
   - 人员过滤：`businessOwnerId in` + `IS NULL` 独立分支；与 `workspaceId/orgId` 同时入 where（铁律 4）。
   - 生命周期档（F4）：由 `listing.openDate` 计算 6月/1年/1-3年/3年以上，SQL `CASE`；作为 where 片段。

4. **新建 `src/components/sellfox/replica/SellfoxFilterBar.tsx`**
   - 从 `replica-workbench.tsx:579-668` 抽出筛选栏；站点改分组多选面板（复用 `SITE_REGIONS` + `siteRegionOf`，:72-86）；店铺级联多选（站点 → 店铺，选项按站点收敛）。
   - 标签/业务员/归属人：生命周期 4 档可用；公共/个人标签与无字段项保持 `disabled` + `reason` tooltip。
   - 不支持的项**不放行空条件**（铁律：筛选即围栏）。

5. **`replica-workbench.tsx` 接入**：`Filters` 类型（:30）扩展数组字段；`initialFilters`（:141）/ `patchDraft` / URL 同步（:350-389）改用 `filter-codec`。

### 测试
- `tests/sellfox-browse-query.test.ts` 扩展：多值 site、人员 NULL 哨兵、批量搜索上限、非法站点 400。
- 新建 `tests/sellfox-filter-codec.test.ts`：编解码往返、旧单值兼容、越界拒绝。
- `tests/sellfox-browse-filters.test.ts` 扩展：多值 where 组合、租户围栏、缺日不补 0。

### 验收断言
- 9 类筛选任意组合，刷新/复制链接不丢条件；不支持项禁用并给原因。

---

## M2 — 聚合语义（约 10 人日，可独立验收）

**目标**：8 维度都可切；父体可折叠；日/周/月重采样与赛狐一致；汇总行与明细自洽。

### 交付物与落地位置

1. **`src/lib/sellfox/workbench-read.ts`（:42, :57, :161-167）**
   - 业务员维度：去掉 `salesDims` 的 `disabled`（`replica-pages.ts:47,133`），在 `dim` 分支加 `COALESCE(s."businessOwnerName",'无业务员')`，分组键 `businessOwnerId`。
   - 父体折叠（`checks.parentAsin`，`replica-pages.ts:115`）：`identity` 用 `COALESCE(l.parentAsin, s.asin)`；「按ASIN汇总」与「按父ASIN汇总」互斥优先级写进 field-registry。
   - 汇总行自洽：确认 `totals`（`replica-workbench.tsx:793`）与各维度明细同源；跨币种分列。
   - 新增聚合键解析表 `src/lib/sellfox/aggregation-keys.ts`：`parentAsin/spu/businessOwner` 的 COALESCE 规则集中管理。

2. **`src/lib/sellfox/browse-grain.ts`（157 行）**：补周/月下汇总行重采样一致性；缺日不补 0（现有 ISO 周逻辑保留）。

3. **`replica-pages.ts:69`**：`defaultDimension: "msku"` → `"asin"`（D1）。

4. **校验脚本** `scripts/verify-sellfox-aggregate.mjs`：同一筛选下「维度明细之和 = 汇总行」；跨币种不相加；缺日不补 0。

### 测试
- `tests/sellfox-browse-grain.test.ts` 扩展周/月重采样。
- `tests/integration/sellfox-sales-profit-p0.ts` 扩展维度切换明细/汇总一致性。
- 新建 `tests/sellfox-aggregation-keys.test.ts`：COALESCE 规则、空值独立成组。

### 验收断言
- 8 维度可切；明细和 = 汇总；跨币种不相加；缺日不补 0。

---

## M3 — 跳转与下钻（约 6 人日，可独立验收）

**目标**：6 个行内入口全部可用，参数带全、新标签打开、失败有兜底。

### 交付物与落地位置

1. **新建 `src/components/sellfox/replica/MetricsTrendDialog.tsx`**
   - 趋势 + 对比表：环比/同比/7天/30天/本月均值；按 grain 重采样。
   - 复用 `browse-grain.ts`；数据源走现有 `workbench-read` 按 asin/msku 单实体查询。

2. **新建 `src/components/sellfox/replica/MskuVariantPopover.tsx`**：子体浮层，展示同父体下 MSKU 列表。

3. **ASIN 外链**：`replica-workbench.tsx` `Cell`（:234）中 `asin` 渲染为 `https://www.amazon.com/dp/<asin>`，`target=_blank rel=noopener`；无 ASIN 禁用。

4. **路由参数约定**：分析→趋势弹窗；运营→`/sellfox/listings?asin=<>&<当前筛选>`；洞察→同 ASIN 看板；全部带 `filter-codec` 编码的当前筛选上下文（铁律 5）。

### 测试
- 新建 `tests/sellfox-row-actions.test.ts`：每个入口带参正确、新标签属性、无 ASIN 禁用。
- `tests/browser/sellfox.spec.ts` 扩展：点击入口后目标页 URL 含完整筛选。

### 验收断言
- 每个入口点击后目标页用同一筛选上下文还原，不跳首页让用户重选。

---

## M4 — 体验与性能（约 8 人日，可独立验收）

**目标**：自定义列（分组/拖拽/模板/搜索）、导出弹窗、前往页码、空态插画、虚拟滚动。

### 交付物与落地位置

1. **扩展 `ColumnPicker`（`replica-workbench.tsx:845`）**
   - 分组数据进 `replica-pages.ts`（基本17/库存14/销售3）；字段搜索框；拖拽排序（现有 dnd 依赖或原生 pointer）；恢复默认。
   - 新建 `SellfoxColumnTemplate` model（org+user+page 唯一）+ migration；「另存模板」读写该表。

2. **导出弹窗**：`export` action 从「导出当前页」改服务端生成 xlsx（`exceljs` 已在依赖）；维度+日期+表头分组勾选；`pageSize` 选项补 200（:806）。大结果流式；前端只下载链接。

3. **前往页码**：已有（:808-820），仅补越界夹取提示。

4. **空态插画**：分场景文案（无权限/无授权/无数据三态），加静态插画资源。

5. **虚拟滚动**：接入现有 `use-virtual-rows`；列宽固定，左侧三列 sticky。

### 测试
- 新建 `tests/sellfox-column-template.test.ts`：模板 CRUD、org+user+page 唯一。
- `tests/browser/sellfox.spec.ts` 扩展：列拖拽/模板/导出弹窗。
- 性能脚本：50 人并发 P95 达标（另见性能验收）。

### 验收断言
- 自定义列可分组/搜索/拖拽/存模板；导出服务端生成；50 并发 P95 达标。

---

## 五条铁律（贯穿所有阶段，作为每段验收门禁）

1. 不造数：快照无字段显示「-」，不拿 Listing 冒充销量维度。
2. null 传播：除零/缺成本/缺汇率/缺库存一律 null，前端不把 null 变 0。
3. 币种不混算：金额按币种分列；跨币种合计显式标「折合」+汇率口径。
4. 筛选即围栏：所有多值筛选服务端与 `workspaceId/orgId` 同时入 where，前端参数不可信。
5. 同上下文下钻：跳转带全当前筛选，目标页原样还原。

---

## 建议推进顺序与依赖

```
M0（字段契约+迁移）  ← 必须先做，M1 的人员筛选、M2 的业务员维度都依赖新列
  ↓
M1（筛选）  ← 依赖 M0 新列；与 M2 有一定并行空间
  ↓
M2（聚合语义）  ← 依赖 M0 新列 + M1 的多值 where
  ↓
M3（跳转下钻）  ← 依赖 M1 的 filter-codec（带参）
  ↓
M4（体验性能）  ← 最后收口
```

**每段独立可验收、独立提交部署**。建议每段完成后跑全量门禁（typecheck/lint/全量单测/build/release-check）再推，避免大批量改动一次性上线。

## 工作量复核

v4 文档估 35 人日（M0 3 + M1 8 + M2 10 + M3 6 + M4 8）。按本拆解，因父ASIN/SPU/开发员已实现、前往页码已有、FBA库存字段较全，**M0/M2/M4 实际工作量低于文档估计**；净增量主要在 M1 多维筛选与 M3 跳转弹窗。建议以本拆解为准重新估时后再排期。

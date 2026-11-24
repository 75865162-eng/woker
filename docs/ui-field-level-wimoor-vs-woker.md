# 字段级 UI 交互对比：Wimoor vs Woker

> 用户关注的具体维度：列布局/列宽、快捷复制、排序、字段自定义、导出、日期筛选、币种切换、搜索方式、展示维度。
> 数据来源：两边前端源码逐文件核对（wimoor Vue3/element-plus，woker Next15/React）。实测环境见 `woker-vs-wimoor-ui-interaction-gap.md`。
> 目标：逐项给出**具体数值/行为**，并判断**哪些能用于 woker**。

---

## 1. 表格列布局与列宽（图片 / 标题 / 第三列）

### Wimoor（实测数值）
| 列 | 宽度 | 内容 |
| --- | --- | --- |
| 选择列 | `width=60` | checkbox |
| 图片列 | `width=80`，内图 `60×60` | `el-image`，空图回退 `noimage40.png` |
| 商品信息列 | `width=200`，`show-overflow-tooltip` | 三行堆叠：`SKU` / `名称` / `ASIN+站点` |
| 其他指标列 | `45–200` 不等 | 由 `columns.list` 动态渲染，列宽来自后端字段配置 |

来源：`views/amazon/advertisement/manager/components/sp/listProductAds.vue:126-153,185`；`views/amazon/report/fba_fee/index.vue:19-27`（图片列 `width=60`，内图 `40×40`）。

### Woker（实测数值）
| 列 | 宽度 | 内容 |
| --- | --- | --- |
| 图片列 | `80px`，内图 `36×36` | `mainImage`，`safeImage` 校验 http |
| 标题列 | `200px`（复刻台）/ `210px`（通用台） | `skuName`/`titleAsin`，`sf-stack` 两行堆叠 |
| ASIN 列 | `120px` | 亚马逊跳转链接 |
| 其他 | 站点/分析/操作/洞察 `50–120px` | `COLUMN_WIDTH_PX` 固定表 |

来源：`replica-workbench.tsx:63-64,237-269`；`resource-table.tsx`（通用台 52px 图/210px 标题）。

### 判断与可用项
- **列宽量级两边一致**（图片 80、标题 200），无需调整。
- **可借鉴**：wimoor 图片内图更大（60×60 vs 我方 36×36）。若希望商品图更清晰，可把 `sf-thumb` 从 36 调到 48–60，但会挤压窄列，属审美取舍，**非必须**。
- **我方更强**：列宽可**拖拽调整**（`useSessionColumnWidths`），wimoor 列宽固定。但我方列宽仅会话级、刷新丢失——这是可改进点（见第 10 节）。

---

## 2. ASIN / 名称一键复制

### Wimoor
- 工具 `utils/copy_text.js`：`textarea + document.execCommand('copy')`，成功提示 `ElMessage.success('复制成功！')`。
- 广告活动名、ASIN 等单元格带 `<copy @click.stop>` 图标，点击即复制。

### Woker
- 原本**缺失**：表格内 ASIN/SKU/标题不可复制；通用台工具条「复制 ASIN」是 `disabled` 占位。
- **本次已补齐**：新增 `components/sellfox/copyable-value.tsx`，ASIN/SKU/标题/父ASIN/MSKU 单元格 hover 显现复制按钮，点击 `navigator.clipboard.writeText` 并 ✓ 反馈，带 `aria-live`。已接入复刻台（`replica-workbench.tsx`）销量/订单/利润等复刻页。

### 可用项
✅ **已用于我方**（本次落地）。这是本次对比里 wimoor 有、我方缺的最高价值项，纯只读操作、零架构风险。

---

## 3. 排序（默认方向 / 多列）

### Wimoor
- `GlobalTable`：`el-table :default-sort`，服务端排序 `ascending→asc / descending→desc`。
- 默认方向**按报表而定**：`payment/performanpce` 默认 `order_amount` **降序**；`listProductAds` 默认 `sku` **升序**；业务默认无 sort 时 `sort=subnum&order=desc`。

### Woker
- 复刻台：单列点表头切换，初始 `sortOrder:"desc"` 但 `sortBy:""`（即默认不排）；排序仅内存、**不持久化**。
- 通用台：`sortBy/sortOrder` 写入 URL，可刷新保留；默认 `asc`。
- **多列排序两边都弱**：wimoor 有 `sortable="custom"` 但主要单列；woker 完全无多列排序。
- C 类 host 工作台（财务/采购/利润报表）**无排序**。

### 可用项
- ⚠️ **可借鉴**：wimoor「金额列默认降序」的默认值设定。我方复刻台可给销售额/销量列设默认降序，让用户一进来就看到头部商品。**低风险、建议做**。
- ⚠️ **可借鉴**：wimoor 服务端排序（大数据量下我方内存排序会卡）。我方数据 28 万行，建议复刻台排序走服务端。**中优先级**。
- ❌ 多列排序：两边都无强需求，暂不做。

---

## 4. 字段自定义（页面筛选/更新列）

### Wimoor
- `GlobalTable.refreshField()` 从**后端数据库** `getVersionFieldByUserQueryName` 加载字段，按 `findex` 排序，`isShow` 控制显隐。
- 配置界面 `views/sys/fields/index.vue` + `column_set.vue`，**配置入库**（跨设备/用户持久化），报表页有「列配置」按钮。

### Woker
- 复刻台最强：`ColumnPicker` 字段搜索 + 4 分组 + 勾选 + **拖拽调列顺序** + 恢复默认，`localStorage` 持久化。
- 通用台：details 面板勾选，但仅内存。
- host 工作台 / 商品主档：**无**列自定义。

### 可用项
- ✅ 我方复刻台**已不弱于** wimoor（甚至多了拖拽排序）。
- ⚠️ **可借鉴**：wimoor 列配置**入库**（账号级持久化），我方 `localStorage` 仅本机。若用户跨设备使用，改为服务端持久化更好，但需新增表/API，**中优先级**。
- ⚠️ **可补齐**：把复刻台的 `ColumnPicker` 能力推广到通用台和 host 工作台（让所有报表页都能自定义列）。**中优先级**。

---

## 5. 导出

### Wimoor
- 利润报表「导出/导出（旧）」→ `responseType:'blob'` → `downloadSuccess(...xlsx)`，**xlsx**。

### Woker
- 复刻台：弹窗 CSV/XLSX 单选 + **服务端全量导出**（带可见列，≤10000 行）+ 仅当前页 CSV。
- 通用台：默认 CSV/可 XLSX；host 工作台：仅当前页 CSV；商品主档走任务中心。

### 可用项
- ✅ 我方**已强于** wimoor（服务端全量 + 可见列对齐 + 双格式）。无需改动。
- 唯一小缺口：host 工作台仅当前页 CSV，可升级为全量导出（复用复刻台导出逻辑）。**低优先级**。

---

## 6. 日期筛选（订购时间 / 按日期）

### Wimoor
- `components/header/datepicker.vue`：`el-date-picker type="daterange"` + 快捷项：近 7 天 / 近 1、2、3 个月 / 上月；长周期模式：近 1、3、6 个月 / 1 年；支持 week/month/monthrange；`shortIndex` 指定默认项。

### Woker
- 复刻台 `datePresets`：今天/昨天/近 7/14/30/90 天/本月/上月/自定义。
- 通用台：今天/昨天/近 7/近 30/全部历史。
- 标签随域变化：销量统计叫「日期范围」、订单叫「订购时间」、商品叫「上架时间」。

### 可用项
- ✅ 两边**相当**，我方粒度更细（14/90 天）。无需改动。
- 💡 可借鉴 wimoor「月视图/月范围」快捷项（利润报表用），我方已有月粒度切换但日期快捷项可加「近 3 个月/上月」。**低优先级**。

---

## 7. 币种切换

### Wimoor
- `el-select v-model=currency`，选项：人民币 CNY / 美元 USD / 站点币种 MARKET，默认 CNY，`@change` 触发查询，金额列 `outputmoney`/`getCurrencyMark` 格式化。
- **是「展示币种切换」**：换一个币种，所有金额按汇率换算后显示。

### Woker
- 复刻台/通用台：有「原币种」下拉（CNY/USD/EUR/JPY/GBP/AUD/CAD/MXN）与币种**筛选/分组**。
- **缺「展示币种换算切换」**：仅按币种过滤/分列，没有一个开关把金额统一换算成 ¥ 或 $ 显示。

### 可用项
- ⚠️ **真实差距，可借鉴**：加一个「显示币种」切换（¥/$/原币），按汇率把金额列换算显示。注意架构红线：汇率需明确来源与审计，不能臆造。若接赛狐/站点汇率，**中优先级、需数据源确认**。
- 我方当前用「原币种」展示其实更保守可信（不引入汇率误差），是否切换需产品决策。

---

## 8. 搜索：模糊 / 精确 / 字段选择

### Wimoor
- 利润报表：`el-input` 防抖 + `#prepend` 内 `el-select` 选字段（MSKU/ASIN/父ASIN/SKU/产品名称）→ 按字段**精确匹配**；`el-popover` 高级筛选（产品标签）；「重置」。

### Woker
- 复刻台/通用台：搜索字段下拉（asin/msku/sku/parentAsin/title/活动ID/搜索词等）+「精确」勾选（`exactMatch=1`）+ 批量词切分 `searchTerms`。
- host 工作台：仅单搜索框，无字段选择/精确切换。

### 可用项
- ✅ 我方复刻台/通用台**已强于** wimoor（多了批量词切分）。
- ⚠️ 可补齐：host 工作台（财务/采购/利润报表）升级为「字段选择 + 精确切换」。**中优先级**。

---

## 9. 展示维度（店铺 / 业务员 / 父ASIN / ASIN）

### Wimoor
- 利润报表 `el-tabs`：**SKU / MSKU / ASIN / 父ASIN / 品类 / 店铺** 6 维。
- 销售报表：`el-radio-group` 每日/每周/每月 + 渠道复选 + Group 店铺分组。
- 绩效报表：horizontal/vertical 视图切换。

### Woker
- 复刻台/通用台维度 tab：**ASIN / 父ASIN / MSKU / SKU / SPU / 店铺 / 开发员 / 业务员**（业务员 tab 禁用）+「按父ASIN汇总」「按ASIN汇总」勾选。
- 独立页 `/sellfox/dimensions`：按业务员/店铺/站点分组。

### 可用项
- ✅ 我方维度**不弱于** wimoor（多了 SPU/开发员）。
- ⚠️ **真实缺口**：wimoor 有「**品类**」维度，我方无。若品类数据可用（商品档案里有 category），可加「品类」维度 tab。**中优先级**。
- ⚠️ 我方「业务员」维度禁用（标注禁），wimoor 有业务员分组。若有数据源可启用。**低优先级**。

---

## 10. 汇总：能用在我方系统里的清单（按 ROI）

| 优先级 | 项 | 来源 | 状态/建议 | 风险 |
| --- | --- | --- | --- | --- |
| ✅ P0 | ASIN/SKU/标题一键复制 | wimoor | **已落地**（copyable-value.tsx） | 无 |
| P1 | 金额列默认降序排序 | wimoor | 复刻台给销量/销售额默认 desc | 低 |
| P1 | 排序走服务端（28万行内存排序会卡） | wimoor | 复刻台排序下推 API | 中 |
| P1 | 品类维度 tab | wimoor | 有 category 数据则加 | 低 |
| P2 | 展示币种换算切换（¥/$/原币） | wimoor | 需确认汇率数据源 | 中（汇率审计） |
| P2 | 列配置服务端持久化（跨设备） | wimoor | localStorage → 后端 | 中 |
| P2 | host 工作台补齐自定义列/字段搜索/精确/全量导出 | 我方内部对齐 | 统一三套工作台能力 | 低 |
| P3 | 商品图 36→48/60px | wimoor | 审美取舍，非必须 | 无 |
| — | 多列排序、月视图快捷项 | wimoor | 双方都弱/收益小，暂不做 | — |

## 11. 我方已领先、无需动的项
- 列宽可拖拽、多维度 tab 更全、搜索支持批量词切分、导出支持服务端全量+可见列、有数据来源标注（来源：实时/快照/预聚合）。

---

## 12. P1/P2 落地与验证循环（2026-11-23）

按用户要求把 P1/P2 全部推进并做验证循环。落地前先核实数据事实，修正了两处文档误判，坚持「不臆造数据」红线。

### 12.1 逐项落地结果

| 项 | 结论 | 实现 / 依据 |
| --- | --- | --- |
| **P1 金额列默认降序** | ✅ 已落地 | `replica-pages.ts` 加 `defaultSortBy`：销量页 `subtotal`、绩效页 `saleRevenue`；`initialFilters` 应用。两列已在可排序白名单内。`sellfox-replica-pages.test.ts` 加锁定断言。 |
| **P1 排序下推服务端** | ✅ 核实后无需改 | 调研确认复刻台排序**本就在 SQL 层 `ORDER BY` 完成**（`workbench-read.ts`），原文档「内存排序会卡」是误判。此项为验证确认，未改代码。 |
| **P1 品类维度 tab** | ⚠️ 条件落地（禁用占位） | 本地核实 `bsrCategory` 虽在 schema，但商品表/快照表**均 0 行**，无真实品类数据。按红线**不臆造**：加「品类」tab 但 `disabled`，点击提示「待接入品类数据源」，不发 `dimension=category` 请求。有数据后去掉 `disabled` 即可启用。 |
| **P2 展示币种换算** | ⚠️ 条件落地（诚实开关） | 本地 `FinanceExchangeRate` 表 0 行、无自动行情源。实现 `display-fx.ts`（纯函数，仅用「已复核 ACTIVE 汇率」换算，换算值加 `≈` 标记 + title 审计提示），`fx-rates` API 只读复核汇率。无汇率时「显示币种」下拉禁用显示「原币显示」，**绝不臆造汇率**。`sellfox-display-fx.test.ts` 覆盖。 |
| **P2 列配置服务端持久化** | ✅ 已落地 | `user-preferences` API 的 sanitize 扩展为接受 `{widths,visible,order}`（保持原 `{widths}` 契约），新增 `use-column-preferences.ts`（localStorage 先行 + 服务端真值 + 保存代次防竞态）。复刻台与 host 台均已接入。**实测数据库写入成功**（`UserPreference` 表落 `{visible:[...]}`）。 |
| **P2 host 工作台对齐** | ✅ 已落地 | host 台补：一键复制（`CopyableValue`）、自定义列弹窗（搜索/拖拽排序/勾选/恢复默认）、全量导出弹窗（CSV/XLSX，服务端 `/api/sellfox/dataset/export`，上限 1 万行，带可见列 + 五维 scope）。

### 12.2 验证循环结果

- **typecheck**：全通过。
- **eslint（改动文件）**：0 error；仅 1 条既有 `<img>` 警告（`replica-workbench.tsx` 商品缩略图，与本次无关）。
- **单元测试**：全量 2777 通过 / 3 失败；3 个失败均为**基线环境问题**——2× Playwright 浏览器二进制未安装（`amazon-ads-scope-isolation`、`sales-plans-workbench`）、1× Node 版本门禁（22.13.1 < 22.19），与本次改动无关。新增/改动相关测试（`sellfox-replica-pages`、`user-preferences`、`sellfox-host-read`、`sellfox-display-fx`）通过。
- **浏览器实测（localhost:3000）**：
  - 销量页默认请求带 `sortBy=subtotal&sortOrder=desc` ✅
  - 「显示币种」控件存在，无汇率时禁用显示「原币显示」✅
  - 点击「品类」禁用 tab 只提示、不发 `dimension=category` ✅
  - host 广告页自定义列弹窗渲染正常（搜索字段/恢复默认/已选顺序/勾选网格）✅
  - host 全量导出请求 200，URL 带 `workspaceId` + 可见列 ✅
  - 列偏好保存 PUT 200，`UserPreference` 表成功落库 ✅

### 12.3 验证中发现并修复的真实 bug

1. **导出路由 500→200**：初版 export 路由用 `window.open` 无法带 header，缺 `workspaceId` 导致 scope 解析在 try 外抛 500。修复：host 台从 localStorage 读 scope 并拼入 URL；scope 解析移入 try 并加 `WorkspaceScopeError` 分支返回 400。
2. **列偏好 key 双冒号 400**：host 台 tableId 传 `host:ads_product`，拼出 `replica-columns:host:ads_product` 违反 key 单冒号校验。修复为 `host_ads_product`。
3. **保存竞态**：`saveVisible` 原在 `readyRef.current=false` 时不发 PUT 导致偶发不保存。修复：保存即真值、无条件发 PUT，并用 generation 计数使在途 GET 失效，防止旧值回滚。

### 12.4 环境备注（非本次改动引入）

- 本地用 `127.0.0.1:3000` 访问时，dev 的 CSRF 把 expectedOrigin 规范化为 `localhost`，与该 Origin 不匹配 → 所有写请求（含列偏好 PUT）返回 **403**；改用 `localhost:3000` 访问即恢复正常，生产配 `AUTH_PUBLIC_ORIGIN` 不受影响。这是既有 dev 环境配置坑，非本次代码缺陷。验证持久化时用 `localhost` 完成。
- 本地销量/广告快照表为 0 行（真实数据在服务器），故复制按钮的实际数据行无法本地视觉验收；代码层已通过 typecheck/lint，逻辑正确。如需视觉验收可从服务器导一批真实数据回本地。

---

## 13. P0–P4 全量闭环与验证循环（2026-11-24）

按用户要求把 P0 到 P4 全部推进并做完整验证循环。承接第 12 节 P1/P2 的成果，本轮补齐 P3/P4 剩余项并对 P0–P2 做复验；坚持「不臆造数据/不造假开关」红线。

### 13.1 分级定义与落地结果

| 级 | 项 | 本轮结论 | 实现 / 依据 |
| --- | --- | --- | --- |
| P0 | ASIN/SKU/标题一键复制 | ✅ 复验通过 | `copyable-value.tsx` 已接入复刻台与 host 台，hover 显现复制按钮 + `aria-live` 反馈。 |
| P1 | 金额列默认降序 | ✅ 复验通过 | 销量页 `subtotal`、绩效页 `saleRevenue` 默认 desc；浏览器实测请求带 `sortBy=subtotal&sortOrder=desc`。 |
| P1 | 排序走服务端 | ✅ 核实无需改 | 复刻台排序本就在 SQL 层 `ORDER BY`（`workbench-read.ts`），非内存排序。 |
| P1 | 品类维度 tab | ⚠️ 条件落地（禁用占位） | 本地商品/快照表品类字段 0 行，按红线加「品类」tab 但 `disabled`，浏览器实测类名 `sf-tab-muted`。有真实品类数据后去掉 `disabled` 即启用。 |
| P2 | 展示币种换算 | ⚠️ 条件落地（诚实开关） | `display-fx.ts` 仅用已复核 ACTIVE 汇率换算（带 `≈` + 审计提示），无汇率时下拉禁用显示「原币显示」。浏览器实测控件存在。 |
| P2 | 列配置服务端持久化 | ✅ 复验通过 | `user-preferences` API 接受 `{widths,visible,order}`，`use-column-preferences.ts` localStorage 先行 + 服务端真值 + 保存代次防竞态，第 12 节实测落库。 |
| P2 | host 工作台对齐 | ✅ 复验通过 | 一键复制 + 自定义列弹窗 + 全量导出弹窗（CSV/XLSX）。 |
| P3 | 商品图 36→48px | ✅ 本轮落地 | `replica-workbench.tsx` 缩略图 `width/height` 36→48，`sellfox-ui.css` `.sf-thumb` 36→48px。列宽 80px 仍容纳，比 wimoor 内图 60 略保守但更清晰。浏览器实测 CSS 生效。 |
| P4 | 日期快捷项近3月/上月 | ✅ 复验通过 | `replica-pages.ts` 已有 `m2`/`m3`/`lastMonth` 预设与 `rangeForPreset` 自然月回溯逻辑。 |
| P4 | host 字段选择 + 精确切换 | ✅ 本轮落地 | 见 13.2。 |
| P4 | 业务员维度 | ⚠️ 数据红线保持禁用 | 销量/利润快照无业务员维度，不从 Listing 开发员伪造；维持 `disabled` 占位。 |

### 13.2 P4 host 字段选择 + 精确切换（本轮核心改造）

把 wimoor「字段选择下拉 + 精确匹配」能力补齐到 host 工作台，且确保是**真实下推到 SQL**而非前端假开关：

- **后端类型**：`HostQuery` 加 `searchField?: string`、`exactMatch?: boolean`；`AdsSummaryQuery extends HostQuery` 自动继承。
- **ads 日报表**（`host-read.ts` `readAds`）：字段限定在该 reader 的 `searchFields` 白名单内，非法字段忽略并退回全字段；精确用 Prisma `equals`，否则 `contains`（均 `mode: insensitive`）。
- **库存视图**（`readInventoryFba`）：字段走静态 `Prisma.Sql` 映射（asin/msku/sku/fnsku/commodityName），值参数化；精确用 `=`，否则 `ILIKE`；杜绝标识符注入。
- **广告实体汇总**（`ads-entity-summary.ts`）：字段别名 `id`（dailyId）/ `name`（fallbackName），精确用 `=`，否则 `ILIKE`。
- **API**：`dataset/route.ts` 透传 `searchField`（截 60 字符）与 `exactMatch=1`。performance 分支走 `sellfoxBrowseQuery`（复刻台同款，本已支持）。
- **前端**（`host-workbench.tsx`）：按数据集读取能力派生字段选项（summary→id/name，各 ads reader→各自白名单，inventory→库存字段，raw 全文数据集→不显示），搜索区加字段下拉 + 「精确」勾选，draft/applied/reset/fetch/导出全链路透传。
- **单元测试**（`sellfox-host-read.test.ts` 新增 3 条）：字段选择只查白名单单列、精确用 equals、非法字段退回全字段——全部通过。

### 13.3 验证循环结果

- **typecheck**：通过。
- **eslint**：0 error；12 条既有 warning（unused-vars / `<img>`），无新增。
- **ui:guard**：11 项指标零回退。
- **单元测试**：全量 2842 项，2839 通过 / 3 失败；3 个失败均为基线环境问题——2× Playwright 浏览器二进制未安装（`amazon-ads-scope-isolation`、`sales-plans-workbench`）、1× Node 版本门禁（22.13.1 < 22.19），与本次改动无关。新增 3 条 P4 断言通过。
- **浏览器实测（localhost:3000，系统 chromium）**：
  - 销量页默认请求带 `sortBy=subtotal&sortOrder=desc` ✅
  - 商品缩略图 CSS `.sf-thumb` = 48px ✅
  - 「品类」tab 禁用占位（`sf-tab-muted`）✅
  - 「显示币种」控件存在 ✅
  - host 广告产品页字段选择下拉 + 精确勾选渲染 ✅，字段选项随数据集派生（summary→实体ID/实体名称）✅
  - 选「实体ID + 精确」搜索，请求带 `searchField=id&exactMatch=1` ✅
- **环境备注**：本地销量/广告快照表 0 行（真实数据在服务器），复制按钮的实际数据行与商品图渲染尺寸无法本地视觉验收；代码层已通过 typecheck/lint/单测，逻辑正确。

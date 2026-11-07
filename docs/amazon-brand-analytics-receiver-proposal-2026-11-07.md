# Brand Analytics 全内容承接与历史回补方案

状态：用户已批准文末所列本地实施、公开文档核验及隔离验证范围；本地实现已完成。未查询真实数据库、读取凭证、调用卖家业务 API、修改真实同步配置、执行真实迁移或启动真实同步。以下保留原始提案，实施结果与最终边界见 `docs/amazon-brand-analytics-delivery-2026-11-07.md`。

## 目标与当前证据

在 `/operations` 的“经营与品牌分析”内承接当前 Amazon 官方 API 实际支持、且目标卖家/站点有资格取得的全部 Brand Analytics 内容，并在批准范围内完成历史回补。Seller Central UI 的所有内容不等于 SP-API 可用内容；不能把未公开、已停用、资格不足或历史不可用的内容算作已同步。

本次核对依据为当前工作区代码（包含其他任务尚未提交的变更），并非线上验收：

- `src/lib/amazon-sync/observation-policy.ts`：已支持 Search Terms、Search Query Performance、Search Catalog Performance、Market Basket；每个任务一种报告、一个完整周期，SQP/SCP 当前策略最多 18 个 ASIN。
- `src/lib/amazon-sync/observation-parsers.ts` 与 `src/data/amazon-contracts/`：已有上述四类官方冻结 schema；字段按 schema 投影、金额及数值保留精确字符串。
- `src/components/operations/observations-workbench.tsx`：四类报告共用通用表格和 JSON 详情，没有逐类完整业务展示。
- `src/components/operations/operations-sections.tsx`：复购为待接入占位入口。
- `prisma/schema.prisma`：`AmazonSyncDataSource` 在组织/工作区/店铺/站点/resource 上唯一；`activeRunId` 为单一发布指针。
- `src/lib/amazon-sync/observations-query.ts`：默认读取该指针对应版本，再按 kind 过滤；无法保证不同报告页签自动选到各自最新成功版本，也没有跨周期覆盖查询。
- `src/lib/amazon-sync/scheduler.ts`：自动调度明确跳过 `brand_analytics`。现状不能承诺全类型连续回补。

## 报告与页面范围

保留 `/operations?view=brand_analytics` 为品牌分析总入口，内部切换子页，不破坏现有链接；`/operations?view=repeat-purchase` 接至同一品牌分析模块的复购视图。

| 子页 | 报告来源 | 展示与承接内容 |
| --- | --- | --- |
| 覆盖总览 | 任务及发布清单 | 店铺、站点、报告类型、周期、ASIN 批次、成功/缺失/失败/无资格/无数据、最新采集时间与来源任务 |
| 搜索词分析 | `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT` | 部门、搜索词、搜索频率排名、点击商品及报告实际返回的点击/转化份额等完整字段 |
| 搜索查询绩效 SQP | `GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT` | 搜索查询、分数/搜索量及实际返回的市场和 ASIN 展示、点击、加购、购买漏斗与份额 |
| 搜索目录绩效 SCP | `GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT` | ASIN 及实际返回的展示、点击、加购、购买等目录漏斗指标 |
| 购买组合 | `GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT` | 主 ASIN、组合购买 ASIN、组合比例及其余返回字段 |
| 复购分析 | 候选 `GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT` | 按最新官方契约接入复购买家、复购销售和周期字段；本地尚无该 schema，须先核验 |
| 其他官方能力 | 待核验 | 核对人口统计、商品比较、替代购买等历史能力的当前公开状态；仅接入仍支持的 API，已停用/未开放能力给出证据与原因 |

以上四个既有报告标识已由本地代码确认；新增候选的可用性、最新周期限制、保留期、地区和字段，以实施时官方文档/schema 核验为准。此方案不宣称候选当前可调用。

每类页面提供店铺/站点、报告周期、日期、ASIN/搜索词适用筛选、后端分页、字段说明、来源与版本、空/错误/无权限状态。全部已核验业务字段提供中文标签及明细；不以原始 JSON 折叠块代替承接页。排名不当搜索量；不同周期不混加；没有可靠分母时不平均份额；未知不补零。

## 最小实施边界

1. 复用 `amazon-sync` 的 Reports 创建、轮询、下载、加密原文、任务日志、预算和租约，不新建 Worker 或另一套同步引擎。
2. 保留一个品牌分析父数据源，新增独立品牌报告计划项/覆盖记录：类型、周期、时间窗口、ASIN 批次与策略版本各自可追踪。优先用现有持久任务承载执行；需要的新表仅承载缺失的计划与覆盖边界，不放宽全局数据源唯一约束。具体增量 migration 在代码实施后单独审阅，未经批准不执行。
3. 每任务冻结完整范围，禁止通过循环改写父数据源配置来轮流运行不同报告；幂等键包含组织/工作区/授权与版本/店铺/站点/报告/周期/对象批次。
4. 按报告类型、周期和对象批次选择最新完整成功版本；查询不再依赖品牌数据源唯一 `activeRunId`。保留显式旧 runId 访问和历史版本，不影响其他观察域。
5. 大报表先评估现有 4 MiB JSON、16 MiB 下载和 50,000 行等容量边界。超过上限显式标记不完整，禁止静默截断后宣布成功；如官方粒度无法拆分，设计有界流式解析并单独验证峰值内存，不直接取消限制。
6. PostgreSQL 保存任务、覆盖与事实；Redis/BullMQ 负责调度；原文沿现有 storage/encryption 边界。新增数据沿组织/工作区/店铺/站点及现有 RBAC/data-access 隔离，不写商品主数据。

预计改动：`src/components/operations/`、`src/lib/amazon-sync/{observation-policy,observation-parsers,observations-query,service,processor,scheduler}.ts`、现有 sync-center API 的品牌相关分支、`src/data/amazon-contracts/`、必要 Prisma 增量迁移、相关 tests 和本方案配套说明。新增品牌专用纯逻辑模块，避免继续膨胀通用组件。最终文件 diff 和迁移另行交付审阅。

## “全量同步”执行口径

全量是批准的卖家/站点内，Amazon 当前允许返回的全部品牌报告、全部完整周期、全部符合资格对象与字段，不表示无限历史或全市场所有商品。

正式执行前生成脱敏清单，列明目标本地数据库身份（loopback 可能是隧道，须核实）、组织/工作区、授权与店铺/站点、API 资格、报告/周期、可回溯起止、对象数/批次、已有覆盖、请求预算、预计存储及影响。当前不读取 `.env`，不猜测目标数据库，不沿用其他聊天的批准。

- 优先复用完整且可验证的已有成功报告；需要创建新报告时走现有审批与未知创建结果保护。
- 每类报告按官方支持的日/周/月/季分别生成完整窗口；不同粒度独立保存，不能把周/月汇总伪装成日明细。
- ASIN 定向报告从目标范围内完整商品清单生成可审阅对象集合并分批，排除无效对象要记录原因；商品清单覆盖不足须在总览显式提示。
- 按限速逐批回补，持久化检查点；限流和发布延迟有界重试；资格不足或官方不可用不反复创建报告。
- 成功、合法空报告、取消、失败、权限不足、窗口不支持分别统计；全部计划项有可核查结论，才可报告完成。最终验收列出无法取得的例外与实际覆盖率。
- 历史回补与持续增量分开配置；新增常驻定时计划默认关闭，待明确批准后启用。

## 影响、回滚与验证

影响：品牌查询/API 契约扩展、同步任务编排、可能的数据库增量表/索引及 `/operations` 品牌视图。回补增加 Reports 配额、数据库写入、原文存储和 Worker 占用；先测单窗口与大 fixture，按现有授权共享预算限速，单批有界，不阻塞 web 请求等待 Amazon 生成报告。若仍争用，可缩小首批历史窗口、降低速率或分时回补；完整目标保持覆盖清单，不将缩小批次误称完成。

回滚：停用新增品牌计划并在检查点暂停品牌任务；回退品牌页面/查询的扩展，保留旧版本读取；保留已同步事实及增量表，数据库向前修复。不回退其他数据域，不删除历史数据，不自动重启或停用现有 Worker。

验证：先用 fixture 测逐类 schema/完整字段、周期边界、时区、ASIN 分批、精确数值、幂等、空报告、超限拒绝、未知创建、暂停恢复、权限隔离及按报告选择发布版本；用隔离 PG/Redis 验证新模型、检查点与覆盖；用 mock 浏览器验证各子页可达与筛选。共享逻辑完成后执行 `npm run check:fast`，准备合码/上线才执行完整 check 与 diff 检查。真实验收需另行批准目标与预算，不能用 fixture 通过代替。

## 审批拆分及已有改动

当前工作区存在大量其他未提交改动，包含 `prisma/schema.prisma`、Amazon processor/service/scheduler、Worker 与 operations 页面；实施应在现状上做最小兼容扩展，不覆盖既有工作。本次不自动 commit/push。未来 GitHub 同步须盘点全部改动并确认范围，随后按 AGENTS.md 追加桌面追溯记录。

本轮请求批准：上述本地页面/同步代码及增量迁移文件的编写，公开官方文档的只读核验，以及隔离 mock/fixture 验证。该批准不包含真实配置写入、迁移执行、Amazon 业务 API 调用、真实同步、Worker 启停、GitHub 推送或服务器部署。

本地实现与隔离验证完成后，提交具体目标、报告/历史窗口/对象清单、精确配置 diff、迁移和配额预算，请用户批准后再执行真实同步。目标或范围变化重新审批。

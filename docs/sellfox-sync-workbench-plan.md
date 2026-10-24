# 赛狐只读同步与数据浏览器实施方案

更新：2026-10-25。状态：库存/销量已完成本机单店真实只读核验与落库，页面与历史浏览已扩展；39 店首次库存/昨日销量同步完成，生产定时任务尚未启用。

### 2026-10-25 第一批实施进度

- 已修正 client 的毫秒 TTL、零/非法有效期拒绝、提前刷新与并发刷新去重；40001 每次调用最多刷新一次；HMAC 仍复用原 client，在排队结束后生成 timestamp/nonce/sign。
- 已实现客户端 2/4/8 秒指数退避加 jitter，参数/白名单/签名/权限错误不重试。永久客户端错误由 Worker 标记不可恢复，避免 BullMQ 再次重试；单店错误聚合后的分类传播仍属后续服务层工作。
- 已统一请求完成后的 1200ms 间隔，加入限流连接断开时取消请求和下次重建连接的处理。跨进程 PostgreSQL 锁故障仍需隔离数据库专项验收。
- 已抽出 inventory/sales 纯请求构造，修正 shopIdList，固定销量 MSKU/日统计及 productNum/salePrice 的独立请求格式。尚未实现两种指标的响应合并，旧解析器保持不可执行。
- 已在 API、service、Worker 与页面统一将 inventory/sales/listings 标为响应契约待验证；禁止启用对应计划，已启用计划由 Worker 记日志并暂停。读历史与导出接口保留，不修改已有快照。此状态是代码级能力限制，不新增环境开关绕过。
- 新增无外网客户端与入口测试，覆盖签名、TTL、限流、退避、token 刷新、永久错误、401/403、未配置文案、资源校验和响应契约限制；全部 190 项仓库测试通过。check:fast 在全仓 lint 因既有 `tmp/create-kayak-sku.ts:75` 的 no-explicit-any 失败，另有商品组件既有 hook 警告；TypeScript 与赛狐定向 lint 已单独通过。
- 本批不改 Prisma、服务器 .env 或生产服务，不运行真实赛狐请求；未运行生产构建/浏览器烟测。下一批仍需成功响应 schema/脱敏样例、连接授权映射和阶段 2/3 的模型、同步及页面任务。

### 2026-10-25 第二批实施进度：日期与断点恢复

- 手动请求支持 `dateRange: { from, to }`，兼容单日及 startDate/endDate，最多 **90 个自然日（含首尾）**。销量/表现默认上海时区 T-1；小时样本限最近 60 天单日；库存/Listing 只允许采集当日状态，不能伪造历史。
- 手动与定时 run 在入队时冻结日期；旧任务按 startedAt 归一化，跨午夜重试不漂移。首次执行冻结工作区店铺清单，重试不因新增店铺改变采集范围；空店铺、已移出工作区店铺明确失败。
- 已对 stores/performance 实现页数据与 checkpoint 同一 Prisma transaction 提交。店铺从下一页恢复、末页标记完成；产品表现按日期与稳定 externalId 保存断点/计数，跳过成功店铺，失败店铺保留下一待执行页并继续其他店铺。最终 result 合并最新 summary，不覆盖已提交进度。
- 未识别响应、无唯一身份、声明未结束却提前空页、非法断点、未到末页即达到分页上限均明确失败，不能标记成功。已识别的合法空列表允许完成；产品表现保留既有字段映射，不代表新增官方响应契约验证。
- 单店错误传播可重试分类；未知数据库异常只记录固定脱敏文案，Worker 不将原始数据库错误写入失败日志/队列错误。永久失败不重复耗用任务重试。
- 新增无外网事务 stub 回归：失败页回滚、失败页重放幂等、下一页恢复、成功店铺跳过、失败后继续、合法空页、未知结构拒写、summary 合并、旧任务日期冻结和日期边界。198 项仓库测试通过；TypeScript 与本批定向 lint 通过；check:fast 仍因既有 tmp/create-kayak-sku.ts:75 lint 错误停止，未改无关文件。
- 用户确认无额外响应样例；公开 Apifox 页面需密码，本地资料仍缺成功响应 schema。inventory/sales/listings 保持禁用。本批不改 Prisma、不访问真实赛狐、不运行数据库迁移或生产部署；未跑构建/浏览器烟测。多副本 claim/租约、跨进程故障、连接授权映射、完整批次模型、销量指标合并及页面剩余任务继续保留未完成。

### 2026-10-25 第三批实施进度：历史浏览与真实只读同步

- `/sellfox` 拆分为连接栏、域导航、资源表、日志健康面板与按需详情。恢复表现的 FBA/FBM 销量、毛利率、退款率和币种列及 Excel 入口；销量表数量列显示“销量”，库存显示“可售库存”。广告小时样本与未接入下载报告明确区分，Listing 给出官方接口名称并保持禁用。
- 新增站点筛选、今天/昨天/近 7 天/全部历史快捷查看与 URL 分享/前进后退。默认 50 行服务端分页；列表与 CSV/Excel 复用 browse-query 日期/店铺/站点/搜索契约，验证实际日期和整数页码，重复店铺参数去重，稳定主键补排序。日志按北京时间任务开始日过滤，不把它解释为报表业务日；日志不应用店铺/站点筛选，页面明确说明。
- 导出读取上限 + 1 条，超出 10,000 条返回 413 并要求缩小范围，不生成缺行文件。详情默认只显示摘要，展开后才请求 `/api/sellfox/:domain/:id`；组织/工作区权限隔离，raw 限制深度/节点/字符串并隐藏凭据字段，截断有提示。
- 概览/计划、列表/日志轮询、同步/计划提交完成及 raw 详情均隔离请求生命周期；切工作区清空旧记录/计数/详情，忽略迟到响应。概览在运行中或日志视图按 15 秒刷新，日志按 5 秒轮询，其余视图不定时重算概览计数。
- 用户提供 App ID 后明确要求开始同步；使用本机已有匹配 App ID 的服务端配置完成 39 个店铺同步。凭据未写入源代码、页面、fixture 或任何新配置文件；未修改服务器 .env，也未请求广告写入。
- 经真实只读请求确认：库存 pageNo/pageSize/totalPage/totalSize/rows，`sku` 为 MSKU、`commoditySku` 为内部 SKU、`fnSku` 为 FNSKU、`available` 为可售库存。销量按 type 分 productNum/salePrice，rows 内为 shopIds/asins/mskus/skus，日指标为 productSaleDayOpenVo[{day,currency,productNum|salePrice}]。以脱敏结构 fixture 固化，解除 inventory/sales 的响应契约禁用；未知结构、跨店、非唯一 MSKU、非请求日、无效指标仍拒绝写入。
- inventory/sales 改用同一事务快照处理器，逐店/逐指标/逐日持久化断点；销量两种指标独立 upsert 合并，保留缺失为 null，同一批次币种/ASIN 不一致拒绝合并。新批次清空未重取的另一指标，避免新旧混用。库存抓取时间在首次执行时固定，业务日取实际采集开始日，不能因跨日排队伪造昨日库存。
- 本机缺少快照表（P2021），审阅并仅应用已有 `20261024020000_add_sellfox_snapshots_sync_schedule`、`20261024030000_preserve_sellfox_snapshot_history`，事务执行后通过 Prisma resolve 登记。本机 migration history 仍有无关 Amazon 分支差异，未 reset、未执行其他待应用迁移；生产数据库未触碰。Prisma validate/generate 通过，schema 无新增改动。
- 首店真实落库与逐条映射核对：790 条库存、41 条 2026-10-24 销量记录，映射差异 0。销量两个指标共 82 次写入合并为 41 行；写入次数不等于独立 SKU 数。其余 38 店库存 7,828 行、销量两指标 440 次写入。最终 39 店任务全部成功（含合法空结果），本地合计 **8,618 条 2026-10-25 库存快照、261 条 2026-10-24 销量日记录**；销量币种为 USD/CAD/GBP/MXN，逐行保留而不混算。重入已成功的四个库存/销量 run 后行数不变。所有定时计划仍关闭。
- 209 项单元/隔离 API 测试及 5 项隔离浏览器烟测通过，TypeScript、定向 ESLint 通过。check:fast 因已有 tmp/create-kayak-sku.ts:75 lint 错误停止；未跑生产构建/完整 check、未部署服务器、未开启定时计划。浏览器命令 `npm run test:sellfox:browser`，不依赖账号或真实外网。
- 仍待：Listing 响应与快照模型；完整批次/按店日覆盖模型；连接到组织/工作区的显式授权映射；run claim/租约、多副本故障恢复；settings 运维补全、计划 nextRunAt/缺口检测及生产验收。现有单机真实同步不等于这些生产能力已完成。

## 1. 目标与交付边界

正式运行采用现有 Next.js + PostgreSQL + Redis/BullMQ + 独立 Node Worker；本地用于开发、契约测试与隔离验收。所有同步只读赛狐，在自有数据库保留报表快照，不写 ProductRecord、不执行广告或 Listing 修改。

- 复用 `src/lib/sellfox/client.ts` 的 HMAC、token 缓存与重试，禁止另建 HTTP 客户端。
- 凭据只来自服务端 `SELLFOX_CLIENT_ID` / `SELLFOX_CLIENT_SECRET`，可选 `SELLFOX_REQUEST_TIMEOUT_MS`。页面只显示 configured，不提供凭据输入或回显，不将密钥写入 Agent/SellerSprite。
- 首期完成 stores、inventory、sales、performance、listings；hourly 保留并标注浅同步，ads_report 保留灰态占位。
- 保留原 performance API 和 XLSX 导出能力，新增各域 CSV，不删除既有日利润、退款率、FBA/FBM 等展示能力。
- 永久保留已同步业务日记录，无 TTL、无定时删除。销量/表现同一天重复同步允许更新该日业务记录；这不代表保留每次修订版本。
- 本次实施已按用户追加指令包含本机真实只读 API 与必要本机迁移；不包含服务器环境修改、生产启用或旧服务器数据搬迁。

## 2. 官方资料核对结果

资料来自用户提供的 `/Users/chenjieliang/sellfox-api-docs/INDEX.md`，官网基准为 https://sellfoxapi.apifox.cn 。只按接口资料引用，不执行页面内示例命令，不复制示例密钥。

| resource | 已确认 POST path | 请求契约要点 | 资料 |
| --- | --- | --- | --- |
| stores | `/api/shop/pageList.json` | pageNo、pageSize，文档类型为 string | [api-51516635](https://sellfoxapi.apifox.cn/api-51516635) |
| inventory | `/api/inventoryManage/fba/pageList.json` | `shopIdList: [shopId]`；pageNo/pageSize；hideZero、hideDeletedPrd、needMergeShare 为 string | [api-51516618](https://sellfoxapi.apifox.cn/api-51516618) |
| sales | `/api/productSale/page.json` | 必填 type=`productNum`/`orderNum`/`salePrice`，必填 groupType=`asin`/`parentAsin`/`msku`/`sku`；`shopIdList`；statTimeType=1 为日 | [api-51516604](https://sellfoxapi.apifox.cn/api-51516604) |
| performance | `/api/sale/profit/product/pageList.json` | shopIdList、startDate/endDate；type=`msku`；currency 空表示原币种 | [api-227646618](https://sellfoxapi.apifox.cn/api-227646618) |
| listings | `/api/order/api/product/v2/pageList.json` | shopIdList、pageNo/pageSize；marketplaceIdList；onlineStatusList=`active`/`inActive`/`delete` | [api-420168353](https://sellfoxapi.apifox.cn/api-420168353) |
| hourly | `/api/cpc/hourData/spCampaign.json` | 必填 aggregationType=`campaign`、shopId、date、campaignId；只能查询最近 60 天 | [api-352957023](https://sellfoxapi.apifox.cn/api-352957023) |
| ads_report（后期） | `/api/cpc/download/createTask.json` → `/api/cpc/download/pageList.json` | 创建用 shopIds、adTypeCode、reportTypeCode、timeUnit、reportStartDate/reportEndDate；进度用 taskIds | [api-52365899](https://sellfoxapi.apifox.cn/api-52365899)、[api-52365898](https://sellfoxapi.apifox.cn/api-52365898) |

补充确认：

1. [Token 文档 doc-1589130](https://sellfoxapi.apifox.cn/doc-1589130) 明确 `expires_in` 单位是**毫秒**，正常 24 小时；0 表示失效。当前 client 乘以 1000 是缺陷，必须修正。
2. [签名 doc-1749562](https://sellfoxapi.apifox.cn/doc-1749562)：按 access_token/client_id/method/nonce/timestamp/url 排序，以 client_secret 作 HMAC-SHA256；body 不参与签名，method 使用 post。
3. [限流 doc-4717915](https://sellfoxapi.apifox.cn/doc-4717915)：每接口每秒一次，超限 code=40019。本项目继续采用更保守的全局串行和请求间隔 ≥1200ms。
4. [公共报错 doc-1759053](https://sellfoxapi.apifox.cn/doc-1759053)：40001 token 失效；40005 IP 白名单；40011 签名；40014 参数/分页上限；40021 无接口权限。公共分页上限为 100；SP 活动特定文档允许 100–1000，首期仍用 100。
5. [SP 活动 api-367482273](https://sellfoxapi.apifox.cn/api-367482273) 用 nextToken 分页，不应套 pageNo。现有前 5 个活动采样只能称浅同步。
6. Listing 文档 switchFulfillmentTo 的配送类型说明有重复 FBA 文案，不能据此推断 FBM 枚举；首期不传此筛选。

### 2.1 资料缺口与准入

上述本地 API 页面只有请求字段和 HTTP 状态列表，没有展开 200 成功响应 schema/样例。路径、请求字段可以定稿，但 rows/totalPage、店铺归属、稳定业务键、库存量字段及销量日列结构仍须补齐证据，不能将当前猜测字段当官方契约。

用户确认无额外 schema；2026-10-25 追加授权后，已在本机默认工作区取得库存/销量真实响应并建立脱敏 fixture。Listing 仍需从同一官方项目补 schema 或用最小只读请求核验。不得把 token、签名 URL 或原始业务响应打印到聊天和通用日志。

每域准入需确认：响应外壳、空列表形状、分页结束条件、shopId 所在层、唯一键、日期/时区、单位及币种、缺省值语义。缺任一关键项时该域标记“响应契约待验证”，同步/计划不可启用；读已有历史数据仍可用。

## 3. 代码基线与必须修正的差异

已存在：稳定 resource 枚举、inventory/sales/schedule 表与增量 migration、共享 sync service、独立 BullMQ Worker/heartbeat、异步 run、日期/店铺分页浏览与导出、快照外键防级联删除。以上为代码存在性确认，不等同于端到端验收通过。

| 优先级 | 当前问题 | 处理要求 |
| --- | --- | --- |
| P0，客户端已修正 | token 有效期毫秒曾被当秒；重试曾为线性且所有错误重试 | TTL、刷新去重与客户端错误分类已修复，待跨进程锁故障验收及单店聚合错误分类传播 |
| P0，请求已修正/响应待验证 | inventory 曾用 shopId，官方参数是 shopIdList | 已改成单店数组；仍须响应归属校验，防筛选被忽略后将全账号库存写入单店 |
| P0，请求已修正/同步待完成 | sales 曾缺必填 type/groupType，用了 shopId | 请求构造固定 MSKU、日统计及两种指标；仍须完成逐日执行及指标身份合并 |
| P0 | rowsFrom 的空结果无法区分合法空页/结构变化 | 显式响应 schema：合法空数组成功，未知结构失败；缺业务身份不能静默 skip 并报成功 |
| P0 | 全局一组凭据可被不同 workspace 调用并拉入全部店铺 | 先建立凭据授权范围到 organization/workspace/shop 的服务端绑定，再允许同步 |
| P1 | 日期默认值在执行/重试时重新计算；stores 恢复读取 pageNo 而非已存 cursor | 创建 run 时冻结日期、店铺集合、抓取时间和请求版本；统一 checkpoint |
| P1 | 完成时用旧 summary 覆盖最新进度；各域失败游标行为不一致 | 原子保留进度与结果，持久化每店/日期完成状态与失败原因，重试跳过已完成单元 |
| P1 | Worker concurrency=1 不保证多副本只有一个任务执行；运行前缺统一身份复核 | Worker 级全局执行锁 + run CAS/租约；复核 active 用户、成员、权限及店铺授权 |
| P1 | 没有店铺可能显示同步成功；达到页数上限可能被当正常完成 | 明确需先同步店铺；硬上限仍有数据时标不完整失败 |
| P1 | Listings 只有灰态；统一站点筛选、raw 详情、设置页健康度不完整 | 按第 7 节补齐；已有功能与新域共用分页组件 |
| P1 | 已新增客户端/入口测试，落库与恢复覆盖仍不足 | 补充服务层幂等、恢复、跨进程故障及 UI 测试，不把 mock 入口验证称作真实接口验收 |

## 4. 数据模型与永久保留

### 4.1 组织、工作区与账号边界

- `SellfoxStore` 保持 organizationId + workspaceId + externalId 唯一，externalId 即 shopId；workspace header 不能代替访问授权检查。
- 一组服务端凭据视为一个赛狐连接，可覆盖多个 Amazon 店铺；首期不提供多个赛狐 client_id 的页面配置。多个赛狐开发者账号需后续单独设计 connectionId 和服务端凭据引用。
- 服务端受控绑定记录该连接可服务的组织/工作区及授权 shopExternalIds。凭据仍只存 env；绑定不含 secret/token。缺绑定或无权店铺失败关闭，不能把服务器全局凭据视为全租户授权。
- 店铺发现只保留目标工作区授权集合；所有请求、写库、详情与导出都带组织/工作区边界。指定店铺在入队和执行时均复核，空数组为当前工作区全部授权且已同步店铺。

### 4.2 各域记录粒度

| 数据 | 保留与幂等键 | 日期语义 |
| --- | --- | --- |
| 店铺 | 现有唯一键，保留最新店铺资料；不自动删除失联店铺 | lastSyncedAt 为连接时间，不表示历史店铺资料 |
| FBA 库存 | storeId + capturedAt + 已核验 sourceKey；同 run 重试复用 capturedAt | reportDate 为实际采集日，capturedAt 为 UTC 抓取时间 |
| 销量 | storeId + reportDate + sourceKey；重复同步 upsert | 赛狐日统计日期，数量/销售额独立缺失时为 null |
| 产品表现 | 现有 storeId + reportDate + sourceKey | 每次请求仅一个报表日；不将区间汇总写成逐日事实 |
| Listing（新增） | 建议 storeId + capturedAt + sourceKey，新增 SellfoxListingSnapshot | reportDate 为采集日；保留当时状态、MSKU/ASIN 及原始摘要 |
| 小时 | 现有 storeId + reportDate + hour + adType/entityType/entityId | 日和小时按赛狐报表口径，不擅自转换站点日 |

库存与 Listing 是“采集当时的状态”：10 月 25 日开始同步，不能反推 10 月 24 日的真实库存/Listing。同步入口拒绝给当前状态接口指定过去业务日；浏览器日期筛选只查询已存在的历史。小时接口上游只支持最近 60 天，但已落库小时记录永久保留，可离线浏览更早日期。

库存 sourceKey 需依据官方响应确认是否含 FNSKU、共享仓、库存状态等维度，禁止以非空字段随意拼接、优先拿 id 就假定稳定。数量字段必须明确表示可售/总库存/在途中的哪种；不能把这些字段作为同义别名互相兜底。

所有报表缺值显示“—”，已明确返回的 0 才显示 0。销量和销售额不同时有值时保留部分指标状态。金额保留原币种，跨币种不直接求和；存储精度和现有 Float 兼容，新增金额采用明确的小数策略并覆盖舍入测试。

### 4.3 保留、安全与容量

- 无自动清理或删除入口；现有快照到店铺外键使用 RESTRICT。Listing 新表沿用此保护。
- 原始 payload 服务端保存，默认列表不返回；响应验证后按店/页事务写入并推进 checkpoint。
- 捕获过程失败的批次保留但标不完整，默认历史视图只选成功批次；原始记录可从 run 追溯。
- 同日快照默认看该店最后完整采集批次，可切换抓取时间。不能把一天 8 次库存相加，也不能混合不同批次去找每 SKU 最近值冒充完整库存。
- 成功空批次也有批次/run 记录，区分“合法零行”与“从未采集”。覆盖率按店铺/域/业务日成功批次计算，不能只看是否曾有一行数据。
- 以最小增量模型提供 capture/run 关联及完整性标记；写入旧批次幂等，旧数据无法确定批次时标 legacy，不猜测成功状态。
- 持久保留会持续增长：S 店 × K 行/店 × C 次/日 × 365 是库存年行数。例如 5 店、各 1000 行、每日 8 次约 1460 万行/年，尚未计 payload/索引/Listing；只是容量示例，不是实测。
- 首期默认库存 3 小时、Listing 每日一次，不自动全历史补拉。用样本测行大小/索引与查询 P95 后再确定磁盘预算；不足时可先降采集频率，历史不自动删除。PostgreSQL 备份及恢复验证是永久保留的运维前提。

## 5. 同步服务与 Worker

### 5.1 任务与执行顺序

手动/定时 → 校验权限及连接范围 → 创建持久化 SellfoxSyncRun → BullMQ 任务 `{ runId }` → 独立 `SellfoxSyncQueue`（concurrency=1）→ 共用 service → 既有 client → 分页事务落库 → runs/overview 查询。

任务冻结：organizationId/workspaceId/resource、shopExternalIds、reportDate 或展开的日期列表、capturedAt、requestVersion。队列单元包含 `{ resource, workspaceId, shopExternalId, pageCursor, reportDate }`，按店/日期/页顺序处理。runId 贯穿快照、批次与日志。

- 缺 Redis 或 Worker 不可用返回明确状态，不退化成浏览器或请求内长任务。
- Worker 多副本需独立全局执行锁，连接断开立即停止新请求；HTTP advisory lock 继续保护其他 Node 调用路径。
- 重试同一 run 采用 CAS/租约避免重复执行；手动与定时同一范围存在活动 run 时返回已有 runId，防重复排队。
- 所有 HTTP（包括 token、重试）统一串行，完成后至少等待 1200ms，再允许下一请求；队列暂停不丢任务。

### 5.2 逐域读取策略

- stores：分页取授权店铺，冻结 run 允许范围；不从缺失响应推断店铺删除。
- inventory：单店 shopIdList；首期 `hideZero: "false"`、`hideDeletedPrd: "false"`、`needMergeShare: "false"`，保留零值和独立记录，业务含义通过响应核验后验收；不传日期筛选，不合并未知仓维度。
- sales：单店、单日、groupType=`msku`、statTimeType=1；type=`productNum` 获取数量，type=`salePrice` 获取销售额；按已核验业务身份和日期合并，币种不一致拒绝合并。orderNum 暂不请求、不冒充销量。分页分别记录指标 cursor，一页验证后写入；日期范围展开为逐日单元，最多 90 个自然日，缺一端按单日归一化，拒绝 reportDate 与范围同时传入。
- performance：保留既有 type=`msku`、shopIdList；逐日拉取与补数，只在完整成功后更新该日覆盖状态。
- listings：单店 shopIdList，首次全量，无时间过滤；不隐藏 inActive/delete 状态。每日全量快照优先，增量游标留给有性能证据后的阶段；不能把 modifiedTime 当历史状态查询。
- hourly：每店最多前 5 个 SP 活动作为样本，标清采样数量和覆盖范围；按官方 nextToken 获取活动后再采样，日期不得超过上游 60 天范围；单店失败继续下一店。
- ads_report：本阶段只显示接口名与灰态，禁止创建真实任务。后期需保存 taskId、异步轮询、超时和 storage fileId；下载 URL 的有效期、域名、大小及响应格式单独验收。

### 5.3 Token、失败与恢复

- `expiresAt = receivedAt + expires_in(ms)`，到期前保守刷新；0/非法 TTL 不缓存，不能缓存成长期有效 token。并发刷新去重，40001 允许一次刷新后重新签名，不无限刷新。
- 40019、HTTP 429/5xx、网络超时可重试；建议等待 2s/4s/8s 加 jitter，仍经过全局限流。参数、白名单、签名及无权限错误立即失败，避免请求风暴。
- client 与 job 总重试预算有上限，避免 4×4 无限放大。每店错误写脱敏 code/类型、尝试次数与下一重试时间；不保存 URL/query/token。
- 单店失败继续后续店；run 只有所有目标单元成功才 done；失败保持现有 failed 状态并在 summary 展示成功/失败店及完整性。连续失败写告警摘要，页面可见。
- checkpoint 记录稳定 shopExternalId、日期、指标、下一页/nextToken，不仅依赖可变化的店铺下标。页数据与 checkpoint 同事务提交，崩溃重放当前页由稳定唯一键去重。
- checkpoint/result 合并更新，不以执行前旧 summary 覆盖进度；中途失败保留最新 cursor，重试不重写已成功批次。
- BullMQ stalled 恢复和数据库恢复分工明确：有效租约仍在的 running 不抢占；租约过期且 Redis 无活动任务的 run 才恢复 queued；多副本恢复要防重。

## 6. 计划与运维

| resource | 默认计划建议 | 默认状态 |
| --- | --- | --- |
| stores | 每 8 小时 | 关闭 |
| inventory | 每 3 小时 | 关闭 |
| sales/performance | 每日 06:30 Asia/Shanghai 拉 T-1 | 关闭 |
| listings | 每日一次 | 关闭，响应契约通过后可启用 |
| hourly/ads_report | 手动浅同步/后期 | 无默认定时 |

复用专用 `npm run worker:sellfox-sync`、`amazon-sellfox-sync-worker` 和 30 秒计划检查；不在页面启动 scheduler。计划启用需 sellfox:create 和有效服务端连接映射，每次执行复核启用人身份/权限；撤销即暂停并写失败 run。

日计划创建任务时冻结 T-1，不在执行/重试时重算。重启跨过 06:30 当日补入一次；不自动追补无限历史。最近 7 日缺口按完整性标记显式补拉；同日重复 tick 及手动竞争只产生一个活动 run。

`/settings` 运维页及 `/sellfox` 展示 worker heartbeat、最近运行/成功、队列等待、下次计划、失败摘要。configured、workerOnline、API 已授权和数据新鲜度是不同状态，不能用 configured 代表“已连通”。

## 7. 页面与 API

组件沿现有 UI 拆分为 connection-bar、domain-tabs、resource-table、sync-runs-panel；统一 loading/error/empty 状态，默认 50 行服务端分页，不加载全表/raw。

- 连接栏：configured、当前工作区、全局店铺多选、资源同步菜单、最近 run。域概览：店铺数、各域完整覆盖率、未采集/失败/过期缺口。
- 域导航：概览、店铺、库存、销量、产品表现、Listing、广告、同步日志。未接入广告报告给出官方接口名，无模拟数据。
- 筛选：店铺、from/to、ASIN/MSKU/SKU 搜索、站点；URL 保存筛选/域/页码，可复制，浏览器前进后退与切 workspace 不能出现旧数据。
- 库存/Listing 可选“当日最后成功批次”及具体抓取时间；日期是业务日，抓取时间使用用户时区显示并注明。
- 点记录打开摘要抽屉；点击 raw 折叠项才取详情，展示大小限制与截断说明。不能让 payload/summary 中敏感错误内容进入页面。
- 产品表现保留原指标/导出能力；金额按币种分组。销量 quantity 标题为销量，不能复用库存标题。
- 缺凭据链接设置/运维说明；已配置无店铺提供同步店铺；有店无库存提供同步库存；尚未获接口权限显示对应域禁用原因。
- 读 sellfox:view；同步及计划 sellfox:create；导出沿用 sellfox:export，不扩大普通 operations 角色权限。按钮与 API 都检查权限。

| API | 契约 |
| --- | --- |
| GET `/api/sellfox/overview` | configured、域计数、按店/日覆盖、latest runs、每域最近成功、worker 状态 |
| POST `/api/sellfox/sync` | resource、可选 shopExternalIds、reportDate/dateRange；兼容现有 startDate/endDate，归一化后冻结入 run；202 + runId |
| GET `/api/sellfox/:domain` | stores/inventory/sales/performance/listings/hourly/runs；分页、日期/店铺/站点/搜索；返回完整性信息 |
| GET `/api/sellfox/:domain/:id` | 新增按需详情；验证 organization/workspace/store 权限，受限 raw |
| GET `/api/sellfox/:domain/export` | 与列表同口径 CSV；保留现有 performance XLSX，转义 CSV 公式；超限返回明确错误，不静默截断 |
| GET/POST `/api/sellfox/schedules` | 读/启停当前工作区计划，返回 nextRunAt、lastEnqueuedAt、最近 run 和 disabledReason |

所有 route 声明 Node runtime，组织来自登录会话，workspace 必须验证归属；维持 x-workspace-id 以及既有导出 query scope 兼容。无凭据 503、无权限 403、非法资源/日期 400、未接入 409，并记录已接受同步的 run；未认证/非法请求不伪造已执行记录。

## 8. 按序实施任务与验收

### 阶段 1：契约与客户端收口

- [x] 修正 TTL 毫秒、退避、重试分类与全局锁断线处理；复用既有 client。（跨进程锁故障专项仍待验证。）
- [x] 修正库存 shopIdList、销量必填参数，建立纯请求构造函数及契约测试。（响应解析/两种指标合并不在此勾选范围。）
- [ ] 补足各域成功/空页/异常响应 schema 与脱敏 fixture，建立解析与归属验证；证据不足的域保持禁用。
- [ ] 完成服务端连接到组织/工作区/店铺的授权映射，覆盖缺映射与越权测试。

完成标准：请求参数与官方文档逐项对应；HMAC/token/40019 无外网测试通过，不能靠猜字段完成响应映射。

### 阶段 2：快照与恢复

- [ ] 审核已存在库存/销量 migration，新增 Listing 和最小批次完整性关联；不修改已部署 migration。
- [x] 库存固定 capturedAt、稳定库存 id；销售逐店逐日/逐指标同步，MSKU+日 upsert 合并并保持 null。
- [ ] Listing 真实契约、固定 capturedAt 与稳定业务键 upsert。
- [x] stores/performance 数据页与 checkpoint 事务提交；修正 stores cursor、稳定店铺断点、旧 summary 覆盖、空店铺/分页硬上限问题，并用模拟事务验证恢复。
- [x] inventory/sales 实现同等事务断点、页数/身份/归属/业务日校验，脱敏 fixture 回归。
- [ ] Listing 在响应核验后实现同等事务断点与完整性检查。
- [ ] run 原子 claim/租约、多副本串行、失联恢复与已有单元跳过；每店错误脱敏保留。

完成标准：同 run 重放不增重复行，不同库存采集保留历史；跨工作区永不混写，单店失败不影响其他店。

### 阶段 3：计划与浏览器

- [x] 手动/日计划入队冻结日期，兼容旧任务 creation date，验证日期范围和小时窗口。
- [ ] 日计划缺口判断，接入 Listing 每日计划和计划 nextRunAt。
- [ ] 完成 `/settings` 健康度、资源能力/禁用原因、run 进度与错误呈现。
- [x] 完成组件拆分、站点筛选/URL 导航、日期历史查询、raw 按需详情、已接入域 CSV 与表现 Excel；恢复既有表现指标。
- [ ] 在完整批次模型完成后补历史批次选择、Listing 浏览/导出与完整覆盖统计。
- [x] 取消/忽略列表、概览、计划与轮询迟到响应；同步/计划提交完成按工作区 epoch 隔离，切 workspace 后清空记录与详情。

完成标准：多店多 SKU 按日查阅、筛选和导出一致；采样/未接入明确可见，成功空批次与缺数据可区分。

### 阶段 4：验证与受控启用

- [ ] 无外网单元测试：签名；TTL 毫秒及 0；token 刷新去重；1200ms 全局串行；指数退避/永久错误；官方请求字段、分页边界、日期上下限。
- [ ] 服务集成测试使用隔离 DB/transport stub：upsert 重放；两次采集；页事务崩溃恢复；失败店后继续；合法空页；未知 schema 拒写；归属不明拒写；日期/指标合并与缺值/币种。
- [ ] route/Worker 权限测试：403、跨 workspace/shop、缺凭据文案、权限撤销、计划防重、running 恢复及多副本互斥；不访问生产库。
- [ ] 浏览器烟测：configured 空态→同步店铺 CTA→各域与日期/站点/店铺筛选→分页→详情 raw→CSV→日志轮询→切工作区迟到响应；可用隔离模拟接口，不造已同步生产数据。
- [ ] 日常相关测试 + check:fast；Prisma 变更补 validate/generate、migration diff/隔离迁移；合码/上线按项目 CI 完整检查。本方案文档本身只做差异与引用核对，不重跑应用测试。
- [ ] 授权后单店单日只读真实验收，核对赛狐后台同口径数量/金额/库存字段、合法空页与第二页；再扩展多店，重复运行验证幂等。

完成标准：库存/销量/表现/Listing 请求与响应均经核验，完整批次入库并可按日期浏览；定时到点入队且脱离浏览器运行。未达成前不能称“生产同步完成”。

## 9. 性能、部署与回滚

全局串行下 100 次请求至少约两分钟，另加响应与写库时间。销量/销售额独立请求约增加一倍销量域调用，逐日补数按天放大；容量/时长影响应在代码实施前向用户说明，采用单店 T-1 及默认关闭计划作为初期方案，不自动全量补历史。

列表索引覆盖 organization/workspace/store/reportDate；按成功批次查库存，不在前端汇总历史全量。记录首批真实样本的 SQL/API P95、行数与存储大小后再评估优化，不先引入 Redis 报表缓存或新 Read Model。

后续明确部署时：完整盘点工作区→确认全部上线范围→GitHub CI artifact→审阅 migration/deployment plan→按清单更新 web 与赛狐 Worker→读取 RELEASE-RESULT.json→单店验收→显式启用计划。不要在本机或服务器绕过 CI 构建。

按 2026-10-25 仓库规则，新部署目标为 `123.207.47.225`，旧 `159.75.203.221`/aecob.com 独立运行；两边数据库不相同。不得自动迁移旧数据、共享/覆盖凭据或同时启动同连接的采集。跨服务器采集若共用赛狐凭据，数据库锁不能跨数据库限流；正式采集只能指定一个主机，或先设计共享限流与主备所有权。

新表/增量约束由 CI 受控迁移；本次不改服务器 .env。已有错误数据如需修复，先只读盘点并保留溯源，再单独批准，不删原始记录冒充历史正确。

回滚先关闭计划和停止赛狐 Worker，再回退应用；新增表/历史保留，不 down migration、不级联删除、不回滚 ProductRecord。记录 `database: not_rolled_back`。本次已完成本机受控只读同步，不执行上述服务器部署操作。


## 10. 定时同步加固进展（2026-10-25）

本轮未改 Prisma schema、未再请求赛狐外网、未修改任何环境文件或启用计划，已入库历史保持不变。

- 手动提交、计划入队和计划开关共用 organization/workspace/resource 的 PostgreSQL 事务锁。同域已有 queued/running 时手动 API 返回 409 与现有 runId，明确拒绝新日期/店铺范围，避免错误地把不同请求当作已接受。
- 计划持锁后重新读取当前启用者；入队和实际执行均检查 active 用户、组织成员当前 sellfox:create 权限及工作区存在性。排队期间撤权的任务失败退出，不调用 Open API。该复核是执行开始时检查，不承诺运行中即时撤销。
- 统一每日 06:30 Asia/Shanghai 与间隔计划的 due/nextRunAt 算法。错过当日时间可补入一次；已入队当天不再次每日入队。不自动补过去多日缺口。
- schedules API 补充 configured、queueEnabled、Worker 心跳、lastEnqueuedAt、nextRunAt。启用计划缺少服务端凭据返回 503。`/sellfox` 展示下次计划；`/settings?tab=operations` 增加受 sellfox:view 保护的独立状态面板，按当前工作区读取计划，每 30 秒刷新并取消旧工作区响应。Worker 心跳是本应用的共享执行进程状态，不暴露主机名或进程元数据。
- 回滚：关闭计划，回退本轮应用提交；不涉及数据库变更或历史清理。默认仍需 Redis + 专用 `worker:sellfox-sync`，页面不启动调度器。

验证：新增每日时区/边界/错过时刻、间隔、防锁键碰撞、权限撤销、缺凭据计划、手动防重测试；5 项隔离浏览器烟测通过。check:fast 的测试阶段通过，lint 仍被既有 `tmp/create-kayak-sku.ts:75` 的 no-explicit-any 阻断；另独立执行 TypeScript 与本轮文件 ESLint。无 schema 变化，不重复 generate/migrate；不做生产构建和服务器操作。

尚未闭环：running 任务的数据库原子 claim/lease、多副本接管与 Redis 丢失恢复、缺日回补、Listing 契约核验及完整批次覆盖模型。当前创建防重不能替代执行租约；定时生产启用前需继续专项验证。

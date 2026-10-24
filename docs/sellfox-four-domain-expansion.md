# 赛狐四域扩展实施审阅（2026-10-25）

状态：此为最初审阅记录，已由用户后续「补货 + 广告优化窄表」目标取代；当前实现与验收以 `docs/sellfox-agent-read.md` 为准，不再扩展四维度矩阵。

## 已确认的差距

- sales：`sync-requests.ts` 固定 `groupType=msku`，`snapshot-sync.ts` 仅采集 productNum/salePrice；解析器拒绝非唯一 MSKU。现有日表唯一键未包含维度，不能直接混写 ASIN/SKU。
- performance：`product-performance.ts` 固定 MSKU、逐日请求；缺失数字当前归零。扩展时应保留缺失语义，并避免按日毛利率/退款率相加冒充区间指标。
- listings：`sellfoxSyncDisabledReason` 禁用，没有 Listing 快照表。V2 文档列出状态、时间和搜索参数，未见父体切换参数；不能据网页子体/父体按钮猜测请求。
- ads：当前只有前五个 SP 活动小时样本。广告结构与历史下载报告需要独立数据模型和任务断点，不能继续以小时样本替代完整广告列表。

## 最小实现边界

1. sales：按所选 `asin|parentAsin|msku|sku` 与 `productNum|orderNum|salePrice` 采集；日长表保留维度、身份、币种和缺失值；服务端按分页实体透视日期列。旧记录视为 MSKU，保持历史兼容。浏览隐藏零不应删掉底层零值；同步摘要保存请求口径。库存只按同工作区/店铺的唯一身份关联最新库存，并注明库存采集时间和来源。
2. performance：同步窗口与 `type` 一并保存为口径，MSKU/ASIN 不覆盖彼此；宽列只映射真实响应存在的数值字段，payload 保留其余字段。区间利润率使用上游区间响应，不累加每日比率。精简/完整档和 CSV 共享列定义。
3. listings：先使用既有 sellfoxPost 对单店分页做真实只读探测，保存脱敏结构 fixture；验证稳定身份、店铺归属和分页后才解除禁用。新增 SellfoxListingSnapshot，保留 capturedAt、完整 payload，默认最新完整快照。未验证父体或指标字段保持灰态。
4. ads：SP/SD 产品优先，活动/组按已验证的管理接口接入，新增 AdsEntitySnapshot；下载报告持久化 taskId、请求范围、轮询状态及 storage fileId。创建任务与轮询可恢复，禁止超时后盲目重复创建；下载地址、大小、格式经验证后才解析入库。未知契约保持禁用，不伪造成功。
5. 横切：沿用 domain IA、sellfoxPost、全局串行队列和租约 fencing；补浏览/导出/详情/计划/同步摘要的相同作用域与筛选。计划默认关闭。所有正式商品主档保持独立，仅写赛狐报表快照。

## 文档证据

本地 `/Users/chenjieliang/sellfox-api-docs/api/`：

- 获取销量数据 api-51516604：type 三项；groupType 四项。
- 获取销售利润数据(产品) api-227646618：type 支持 msku/asin/parentAsin/sku/shop/developer/salesman；startDate/endDate、mergeAsin、onlySettle。
- 获取在线产品信息V2 api-420168353：shopIdList、pageNo/pageSize、onlineStatusList；未验证响应前不可据参数文档解除禁用。
- 创建广告下载任务 api-52365899、查询广告报告进度 api-52365898；SP/SD 广告产品、活动、组管理文档。

请求文档不等于响应证据；列映射表必须在真实响应核验后记录「中文列/API key/DB 字段/口径/缺失行为」。

## 影响、性能与回滚

- 影响范围：仅赛狐 UI、浏览/同步 API、专用 worker 使用的同步契约、Prisma 报表表、迁移及测试/文档。不改权限模型、ProductRecord、广告写入、服务器配置。
- 若同时拉四维度三指标，相比现有一维度两指标约六倍销量请求；至少 1200ms 串行意味着每 100 次请求仅间隔就约两分钟，另加响应与落库。采用按所选维度/指标采集、分页读取和默认关闭计划；不自动全店全历史扩采。新增快照增加数据库空间，下载报告增加 storage 占用。
- 新迁移只增量扩展并兼容旧记录，不改已有 migration；不在本任务中自动迁移生产。回滚关闭新增计划、回退应用，保留新增表与历史数据，不执行 down migration 或清理主档。

## 验证路线

- 相关契约/同步/浏览/API 测试覆盖：维度身份、防混写、日期/币种、null 与零、幂等恢复、分页、跨 workspace、可见列导出和报告任务断点。
- `npm run check:fast`；Prisma 改动补 validate/generate、SQL 审阅与隔离迁移验证。不默认跑完整 check/build。
- 单店有限只读 API 探测，脱敏 fixture；最终同店同日期同维度核对网页数据。无网页登录或真实响应时明确保留验收缺口。

## 工作区同步待确认

开始时已有 Agent 链路/选品、package.json/package-lock.json/.gitignore，以及赛狐租约恢复相关改动与新迁移。schema、sync-service、worker 和测试存在重叠，必须兼容保留，禁止 stash/reset。GitHub 同步前须明确这些已有改动是否整体纳入；不得只提交本聊天文件造成部分同步。

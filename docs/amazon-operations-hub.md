# Amazon 经营中台（内部 ERP）

入口 `/operations`。保持现有登录、organizationId + workspaceId 和模块权限。页面只查本地数据库，Amazon 凭证只在服务端；不写 Amazon，不向 `ProductRecord` 写同步字段。

## 页面

- overview：当前工作区/站点、六域健康、最近成功、下次计划与失败。
- sync：间隔、启停、立即同步、最近 20 次运行。库存与在线产品具备执行器，其它域仍未接通。
- inventory：最新成功库存快照汇总、SKU 搜索/分页、STALE 提示。
- catalog：按 Seller SKU + SellerAccount + Amazon Marketplace 展示刊登/库存、来源、更新时间和错误。
- replenishment：新品/成熟品策略、历史销量及周期维护、每天生成的只读补货建议和风险依据。
- ads：现有 PPC 入口；缺少日粒度 SKU/ASIN 关联时明确 NOT_SYNCED，不把别的报表冒充 PPC。
- orders：NOT_SYNCED 占位。
- runs：最近 20 次运行的域/状态/日期筛选、summary/error/耗时。

Product Center 主列表保留原分页/过滤/缓存路径，在返回当前页时批量读取 Amazon 快照，附加 `amazonSnapshots`；只有同时拥有 `operations:view` 才返回附加字段。这些字段不进入主数据响应缓存，保存入口剔除这些只读字段。列表不逐 SKU 请求、不请求 Amazon，也不覆盖公司主数据中的 ASIN 或状态。每页最多 200 SKU，快照关联最多 4000 行，超出或未迁移时以附加错误提示降级，不影响公司商品列表。列表既有浏览器短缓存仍可能短暂展示旧快照，精确新鲜度以快照时间为准。

## 同步与店铺绑定

`AmazonSyncSchedule` 按组织/工作区/域唯一。默认全部停用；库存建议 60 分钟，在线产品建议 1440 分钟。广告预留 120 分钟（实际来自 PPC，不另建同步），订单预留 15 分钟，其它域日更预留但不可启用。间隔允许 15–10080 整数分钟。修改计划重置计时；启用一个间隔后首次执行。停用只阻止后续任务，不取消已排队任务。

专用 worker 每 30 秒检查计划，只创建 AmazonSyncRun，再由原队列派发和 processAmazonSyncRun 拉数。多调度器事务锁 + 幂等键、手动/计划共享入队锁、同工作区/域跨 HTTP session advisory lock 防双跑。任务完成从 BullMQ 移除，结果保存在数据库。最多 3 次指数退避，429/5xx 才自动重试；每页之间至少等待 600ms，Amazon 返回限流仍按错误处理。最多 1000 页、单工作区一次 50000 行、最多 10 条店铺映射；全部拉取完成后事务写入，失败删除本次半成品，保留以前成功快照。超过 15 分钟 RUNNING 且原 session 锁已释放才终止 FAILED 清理，不抢占活跃运行。

当前仍是一组进程凭证绑定一个组织/工作区和一个真实 Seller ID；不支持把同一 token 用于多个 Seller ID。多 seller 凭证库属于后续工作，不通过 accountKey 猜身份。每个 Seller ID + Marketplace 只能映射一个 SellerAccount。允许同一 seller 的多个站点。

必须在服务端配置（不在浏览器填写）：

- DATABASE_URL、QUEUE_DRIVER=redis、REDIS_URL。
- AMAZON_SP_API_LWA_CLIENT_ID / LWA_CLIENT_SECRET / REFRESH_TOKEN / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY（均带 AMAZON_SP_API_ 前缀）。可选 AWS_SESSION_TOKEN、AWS_REGION、ENDPOINT；使用官方对应区域 endpoint。
- AMAZON_SP_API_ALLOWED_ORGANIZATION_ID、AMAZON_SP_API_ALLOWED_WORKSPACE_ID 精确绑定。
- `AMAZON_SP_API_SELLER_BINDINGS` JSON 数组。字段：organizationId、workspaceId、sellerAccountId（ERP SellerAccount.id）、marketplaceId（Amazon ID）、amazonSellerId（真实卖家 ID）、authorizedResources（实际已授权的 inventory/catalog 域）。accountKey 不作 Seller ID 使用。

配置模板仅用占位符：

```json
[{"organizationId":"<org>","workspaceId":"<workspace>","sellerAccountId":"<ERP store id>","marketplaceId":"<Amazon marketplace id>","amazonSellerId":"<authorized seller id>","authorizedResources":["inventory","catalog"]}]
```

SellerAccount 必须在当前组织/工作区且 active。先校验 Marketplace Participations，再执行只读 Inventory Summaries 或 Listings Items API（searchListingsItems /listings/2021-08-01/items/{sellerId}）。只在应用实际取得对应官方接口授权时将该域加入 authorizedResources；配置声明不授予 Amazon 权限，403 会可追踪失败，不能绕过角色或限流。缺绑定时 worker 标为 BLOCKED，不发外部请求。Seller ID 映射尚待用户提供，未开展真实请求验收。

```bash
npm run worker:amazon-sync
```

历史无 sellerAccountId 的库存行保留，但新商品联看/补货不猜测它属于哪个店铺。首次补齐绑定后重新同步。库存使用官方 payload.inventorySummaries，兼容历史解析输入；预留/不可售/调查中使用嵌套 total 字段，格式异常不得当作空同步成功。

## 新鲜度与字段来源

库存默认 360 分钟 STALE，`AMAZON_INVENTORY_FRESHNESS_MINUTES` 允许 15–1440。刊登快照超过 48 小时 STALE。六域 summary 返回 lastSuccessAt、nextScheduledAt、最近尝试/错误。刊登成功不代表库存新鲜；表格分别显示两个快照时间。

AmazonCatalogSnapshot 存字段来源 JSON、sourceRunId、capturedAt；库存存 syncRunId、capturedAt，字段来源固定为 SP-API FBA Inventory Summaries。只读投影按复合键合并，保留 null（缺刊登状态/缺库存），不把未同步显示为 0。使用最近一次完整成功运行，防止新运行缺失的 SKU 被旧快照“补活”。失败详情由对应 AmazonSyncRun 查询。

库存数量只接收明确的非负整数，包括可售、三类在途、预留、不可售及调查中总量。响应缺失数量或数量无效时整次同步失败并保留旧成功快照，禁止以 0 代替未知量；真实空 inventorySummaries 可以成功。

## 补货建议

策略按组织/工作区/店铺/Marketplace/SKU 唯一，operations:edit 人员维护。可以手动粘贴每日销量（日期,件数），或显式绑定当前工作区已有 SellfoxProductDailySnapshot 的报表店铺。读取内部历史不发起第三方同步；报表来源额外需要 sellfox:view，并在建议页面/API 权限不足时隐藏相关策略。只接收精确单 MSKU，原始 payload.saleNum 必须存在且为非负整数；同日期多条、多 MSKU 汇总、缺失字段不累加、不补零。当前利润/ACOS 由人工维护参考值，不自动把报表 grossProfit 当净利润。

worker 对启用策略首次/修改后重算，以后每 24 小时重算。每轮最多 50 条；页面 GET 只读计划表。修改参数并保存可触发按需重算，正常 worker 下一轮约 30 秒内开始。失败记录 lastError、空建议并 30 分钟后再算；不覆盖新版本策略的结果。停用保留旧计划但标注停用。保留本次输入快照、策略版本时间、库存运行 ID、生成时间与下次计算时间，方便追踪。库存运行 ID 直接取自本次实际读取的快照；同策略版本较早发起的并发计算不能覆盖较新结果，失败时清空本次库存运行引用。

- 新品：人工试销日需求；不套用成熟品 28 天均值。
- 成熟品：上海日期口径、昨日结束的完整 28 天日均销量；缺一天就是待补资料，零销量不能推断未来需求。
- 去年同期：只使用显式维护、有来源和对比窗口的季节性系数；缺失时不调整并提示旺季风险。当前不自动推算同比系数。
- 周期：生产 + 国内运输 + 海运，必须维护，缺项不输出补货量。
- 可售天数：当前可售 / 预测日需求（不将预留、不可售计入）。
- 目标量：日需求 ×（总周期 + 安全天数 + 复核天数）－当前可售－窗口内已知 ETA 在途，向上取整且不小于零。默认安全 14 天、复核 30 天，可维护。
- 库存模拟按日加入明确 ETA 到货，首次不能满足一天需求即预计缺货日；建议下单日倒推周期及安全天数，可能已过期，必须保留以提示紧急。
- Amazon 总在途仅作风险提示；没有 ETA 不扣减，逾期未确认到货也不当作可售。
- 单位利润/币种、ACOS/归因窗口是参考与风险说明，不重复计广告销量，不认定净利润，不自动抑制或执行采购。

当前是可解释的基础计划，不包含仓库/PO 系统自动 ETA、自动同比、统一利润核算或预测模型。数据缺失统一 NEEDS_DATA；READY 仅表示基础计算输入齐，不是采购批准。

## API

所有查询 no-store，组织来自 session，workspace 来自既有 scope；未登录 401、无权 403。

- GET /api/operations/freshness、readiness：operations:view。
- GET /api/operations/inventory/snapshots?page=1&pageSize=50&sku=SKU：最新成功库存，页大小最多 200。
- GET /api/operations/products?page=1&sku=SKU：最新完整刊登/库存运行，50 个 SKU 一页，店铺/站点分行。
- GET /api/operations/metrics/daily：当前 PPC 日投影未接，空行/null + 说明。
- GET/PATCH /api/operations/schedules：view/edit；POST sync-runs：create，资源 inventory 或 catalog，幂等键必用。
- GET/PATCH /api/operations/replenishment：view/edit；策略输入维护在 ERP，Amazon 仍只读；历史报表额外权限见上文。

AmazonAgentActionAudit 仅预留未来 preview-confirm，不提供真实写回入口。P1 利润统一口径、Amazon Ads 接入、P2 通知+对账补偿均未在本轮开放。

## 迁移、回滚与验收

新增 migration `20261023010000_add_amazon_catalog_replenishment`：库存店铺列/索引、刊登快照、补货策略与计划、开放 catalog 计划约束。迁移先人工审核，再按既有 CI 流程应用；本轮未执行本地/生产 migrate。回退前停用计划与策略，再回退应用，保留表及数据；数据库不自动 down。

性能预算：主列表仅为当前页附加批量 DB 查询，不切换主读路径；专用 worker 有界处理，但更频繁同步增加 API 和快照存储量，每个运行额外持有一个 PG session 锁连接。本轮没有 1000/5000/10000 SKU 真实 P95 benchmark，不声称已经加速；扩容前应验证分页 SQL/P95 和快照保留策略。

验收：

1. 审核并应用迁移、填写授权绑定；先以受控测试店铺校验连接。启动专用 worker。
2. 启用 inventory/catalog 计划，验证到期自动 SyncRun、手动/定时无双跑；错误/403/限流可追踪、失败不留半成品。
3. 商品页不请求 Amazon、公司字段不变；在线快照按店铺/站点分行，切 workspace 不串数据。旧无店铺库存不参与联看。
4. 有数据/无数据、失效授权、不同权限/组织/工作区及 Network 无 token 检查。
5. 新品/成熟品维护、完整/缺日历史、缺周期、STALE、未知 ETA、到货前缺货、利润/季节性缺失都给真实说明。保存后等 worker，结果带输入快照与时间，不自动创建采购单。
6. 原库存及产品模块回归。测试与构建结果见 specs/004-amazon-operations-hub/quickstart.md；真实 Seller ID、DB/Redis/Amazon 及登录浏览器验收待受控配置。

## 隔离浏览器回归

运行 `npm run test:operations:browser`。沿用商品草稿浏览器测试的 esbuild + Playwright 隔离方式，测试数据和模拟 API 仅存在于 tests/browser，不创建应用演示数据、不访问数据库、Amazon 或生产，不需要登录凭证。

覆盖六域概览及 STALE 原因/建议、未同步库存各数量不补 0、刊登缺字段、PPC/订单占位、计划只读/编辑控件、手动同步工作区及幂等键、模拟 403 展示，以及切工作区后库存/指标/状态/手动同步迟到失败不污染新工作区。真实登录、403 服务端权限检查、DB/Redis 多进程锁、Seller ID 和 Amazon 联调仍按上方受控验收执行。

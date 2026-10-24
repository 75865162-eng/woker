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

服务端基础配置：

- DATABASE_URL、QUEUE_DRIVER=redis、REDIS_URL。
- `AMAZON_SP_API_ENCRYPTION_KEY`：网页凭证的 AES-256-GCM 主密钥，必须是 32 随机字节的 Base64 编码。生成示例：`openssl rand -base64 32`。主密钥不得提交到仓库；备份到受控密钥管理位置。更换主密钥前必须先完成数据库凭证解密和重加密，否则现存凭证无法读取。
- LWA/AWS 凭证在系统设置「集成」Tab 输入，按 organizationId + workspaceId 保存为 AES-256-GCM 密文。API、页面和审计记录均不返回密钥。旧 `AMAZON_SP_API_LWA_CLIENT_ID` / `LWA_CLIENT_SECRET` / `REFRESH_TOKEN` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`、可选 `AWS_SESSION_TOKEN`、`AWS_REGION`、`ENDPOINT` 仍支持作为兼容 fallback；fallback 仍需 `AMAZON_SP_API_ALLOWED_ORGANIZATION_ID` 和 `AMAZON_SP_API_ALLOWED_WORKSPACE_ID` 精确绑定。
- `AMAZON_SP_API_SELLER_BINDINGS` JSON 仅作为数据库没有当前 scope 绑定时的旧配置 fallback。字段：organizationId、workspaceId、sellerAccountId（ERP SellerAccount.id）、marketplaceId（Amazon ID）、amazonSellerId（真实卖家 ID）、authorizedResources（实际已授权的 inventory/catalog 域）。accountKey 不作 Seller ID 使用。

系统设置新增「集成」Tab，可在当前组织/工作区维护 Amazon LWA/AWS 凭证及 active SellerAccount 的 Seller ID、Marketplace、授权同步域。凭证密文存于 `AmazonIntegrationSecret`，店铺映射存于 `AmazonSellerBinding`；两个配置 API 均需要 `settings:edit`，连接验证仍使用 `operations:edit`。更换凭证会清除旧连接验证状态，要求重新验证。店铺绑定优先读数据库；当前 scope 数据库没有绑定时兼容旧 `AMAZON_SP_API_SELLER_BINDINGS` JSON，面板支持导入。审计只记录变化字段名称/绑定行数，不记录凭证值。新增迁移：`20261024000000_add_amazon_seller_bindings`、`20261024010000_add_amazon_integration_secrets`；应用前按受控迁移流程审核。回滚应用时保留密文表和主密钥，不自动删除数据。

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

AmazonAgentActionAudit 已接通出价 preview → confirm → apply 审计；本版本 apply 仅 dry_run 或明确失败 NOT_IMPLEMENTED，真实 Amazon Ads 写回尚未开放。利润统一口径、通知和对账补偿仍未开放。

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

## 内部只读 CLI 与 PPC 审批审计（2026-10-24）

链路：同步仓 → CLI/Agent 读取本地 PostgreSQL → 优化草稿 → 人工确认 → 受控执行检查。这是公司内部 ERP 能力，不对外提供 SaaS。只有既有 inventory/catalog worker 负责官方只读同步；CLI/Agent 不直接请求 Amazon，也不启动同步任务、写 ProductRecord 或执行维护脚本。orders/finance/fulfillment 的执行器仍 BLOCKED。

### CLI 配置与命令

本机/服务器终端运行，无 HTTP listener，无公网 CLI API。使用受控 OS 账号和服务端环境配置授权，不接受命令行传入 Amazon 凭证或任意组织身份。按 Next 规则读取当前目录的 `.env*`；配置内容及数据库错误详情不输出。建议使用仅具 SELECT 权限的独立 PostgreSQL 用户，再由 PostgreSQL `RepeatableRead + READ ONLY` 事务强制禁止数据库写入。

必需：`DATABASE_URL`、`OPS_CLI_ORGANIZATION_ID`、`OPS_CLI_ACTOR_USER_ID`、`OPS_CLI_WORKSPACE_IDS`（逗号分隔）。操作者必须是当前组织 active 用户及有效成员，工作区必须存在且在允许列表中。所有命令检查 operations:view，PPC 命令另检查 workspace:view 和 agents:view；读取既有权限配置但不触发角色初始化/seed。组织身份没有 CLI 覆盖参数。

```bash
npm run ops:cli -- --help
npm run ops:cli -- freshness --workspace <workspace>
npm run ops:cli -- inventory list --workspace <workspace> --sku <sku> --page 1 --json
npm run ops:cli -- inventory summary --workspace <workspace> --json
npm run ops:cli -- catalog list --workspace <workspace> --sku <sku> --page 1
npm run ops:cli -- metrics daily --from 2026-10-01 --to 2026-10-24 --asin <asin> --json
npm run ops:cli -- sync runs --resource inventory --status SUCCEEDED --page 1 --json
npm run ops:cli -- ppc report-summary --workspace <workspace> --json
npm run ops:cli -- ppc suggest --workspace <workspace> --json
```

Agent/脚本需纯 JSON 时使用 `npm run --silent ops:cli -- ... --json`，或直接 `node_modules/.bin/tsx scripts/ops-cli.ts ... --json`，避免 npm 自身打印 script banner。错误输出 stderr、成功输出 stdout。退出码：0 成功（包括明确缺数据/null）、2 命令/参数错误、3 身份/权限错误、4 数据库/读取/分析错误。列表每页最多 50 行；inventory/catalog 仅读最新完整成功运行，不以历史 SKU 补齐；无成功运行返回 NOT_SYNCED。只读查询不会排队同步。

`metrics daily` 允许最多 90 天，`--asin` 与 `--sku` 二选一；现有 PPC 数据未建立可靠日粒度 SKU/ASIN 映射，所以返回空行、指标 null 及原因，不把导入日期当作报表日期，不用其他报表冒充 PPC。`inventory summary` 没有成功快照时 summary 为 null。

PPC 仅读当前操作者、组织和工作区最新 `WorkspaceDataset`。不读取其他员工导入、不访问浏览器 IndexedDB，也不把多个导入批次重复累计。缺数据返回空草稿；超过 10000 行拒绝全量分析，需先缩小导入数据集。`report-summary` 汇总现有码的 PPC 指标；`suggest` 复用 PPC runtime/analytics，输出兼容 `PpcAnalysisReport` / `adjustmentDrafts` 的 JSON，只输出报告，不持久化或发起审批。库存过期/未同步及广告周期 UNKNOWN 均附 freshnessWarnings；导入时间始终不代表广告报表新鲜度。

### Preview、confirm、apply

前置：现有 AmazonAgentActionAudit 等迁移已经应用，当前组织具有启用的 `ppc` AgentDefinition 及 WorkspaceScope。缺表/缺配置不降级成内存预览，不自动迁移或种子初始化。

- POST `/api/agents/ppc/actions`：agents:create。body 包含 `actionTarget: "amazon.ads.apply"`、report、adjustmentDrafts、必填 idempotencyKey（8–160 位字母/数字/冒号/下划线/连字符）；工作区遵循既有 body/header/query scope。只提取 update_bid，其余建议保留在报告中，不进入执行计划。
- Preview 在单事务中创建 AgentExecution、AgentTask、AgentApproval 和 AmazonAgentActionAudit(PREVIEW)，记录 old/new、审批 ID、请求摘要、幂等键、30 分钟 expiresAt。oldValues 来自用户提交报告，标明 `submitted_report_unverified`；rowId 不认作 Amazon keywordId/targetId。
- 同 org/workspace/key 请求重放返回原记录；不同请求内容或操作者使用同一 key 返回 IDEMPOTENCY_CONFLICT。preview 事务锁及现有唯一约束防重复落库，失败整笔回滚。
- POST `/api/agents/approvals/{approvalId}`：复用 agents:approve。Amazon 审批必须通过 `x-workspace-id` 或 query workspaceId 指定原工作区；数据库检查 organization、workspace、approval/execution/audit 绑定和到期。REQUESTED 条件更新 + 审计事务锁防并发确认，拒绝/过期也记录审计。旧版没有 audit 的 Amazon 审批不能直接执行，需重新 preview。
- 开关 false 时确认仍为 PREVIEW，confirmedAt、审批人及批准状态记录人工确认；true 时确认为 CONFIRMED。确认只授权，尚未执行，Execution 为 WAITING_TOOL。
- POST `/api/agents/ppc/audits/{auditId}/apply`：agents:approve，header/query 工作区必须一致，body 只需原 preview 的 idempotencyKey，不接受替换 plan。服务从库中重新检查人工批准、到期及状态，然后调用 `amazon.ads.recommendation.apply` gateway。直接调用 adapter、没有持久化审计服务授权时返回 AUDIT_REQUIRED。
- false（包括缺省）：只写 `newValues.execution.status=DRY_RUN_BLOCKED`、`externalWriteAttempted=false`，审计保留 PREVIEW。true：完整批次在 HTTP 前失败，记录 FAILED / NOT_IMPLEMENTED，API 返回 501；没有部分写入、没有 APPLIED。两种结果都可重复查询/重放，重复 apply 不再次执行。若开关后来改变，旧 dry_run 的同一 key 仍只重放；需新建 preview 并重新审批。
- GET `/api/agents/ppc/audits`（最近 20 条）和 GET `/api/agents/ppc/audits/{auditId}`：agents:view，按 org/workspace 过滤，no-store。`/agents/ppc` 展示 PREVIEW/CONFIRMED/FAILED 等记录、old/new、到期、警告及结果，允许人工确认/拒绝和执行检查；支持空、加载、错误状态，切工作区清空旧结果。

硬限制：每批 1–100 条出价更新，目标非空、不重复，old/new bid 必须是有限数且在 [0.02, 100]；超过 50% 变动显式告警。此范围是额外保守闸门，不代表所有站点/币种的官方范围；未有可信 profile/币种及实体映射前不能真实执行。

### Ads stub 与如何打开

`src/lib/amazon/ads-client.ts` 提供 `AmazonAdsBidClient.updateBids`、SP v3 keyword/target PUT 请求构造、完整批量校验、207 逐实体响应解码及安全错误映射。Ads 使用 LWA Bearer + ClientId + Profile Scope，不复用 SP-API SigV4。请求体分别为 keywords / targetingClauses；本轮不提供 add_negative_keyword 写接口。401/403/429/5xx 不回显上游响应体，不自动重试，缺失/重复响应 index 或 entity 不符标记 OUTCOME_UNKNOWN，需要核对后再试。

**本版本不能通过环境变量打开真实写入。** `AMAZON_ADS_EXECUTION_ENABLED=false` 是默认配置；设为 true 只能验证 NOT_IMPLEMENTED 失败闸门。未来开启步骤必须包含：实现并复核真实 transport；服务端组织/工作区到 Ads profile、region、币种、官方 keywordId/targetId 的授权映射；核验实时 old bid；LWA 刷新/超时/敏感信息清理；逐实体结果与不确定响应对账；受控测试账号联调及独立审批，再设置 true。不可把本地 rowId 直接发给 Ads，也不可仅删掉 NOT_IMPLEMENTED 便上线。

### 验证与回滚

本轮不新增 schema/migration，不调整 SyncRun/Schedule/worker，不执行生产维护/迁移/部署。回滚：关闭开关并回退应用代码，保留审批及审计数据；不自动删除记录或数据库 down。旧应用不支持的新审计记录不应由旧入口继续执行。

自动验证：`npm test` 覆盖 CLI 全命令只读 smoke、权限/参数、PPC 建议、审计事务服务及 stub 集成；`npm run test:operations:browser` 包含审计 old/new、确认/dry_run、空/失败及工作区切换，沿用库存/刊登同步页面回归；另跑 lint、typecheck 和生产 build。事务服务测试使用内存 delegate double，浏览器使用隔离模拟接口；它们不替代真实 PostgreSQL advisory lock/唯一约束、多进程并发、受控账号和 Amazon 联调。尚无真实 P95 benchmark，不宣称性能提升。新增分析按需、有 10000 行上限；更大数据集或并发使用前需测内存/延迟。

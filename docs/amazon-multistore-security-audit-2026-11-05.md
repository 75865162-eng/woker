# Amazon 多店铺与 MCP：实施前代码审计和分阶段方案

日期：2026-11-05。状态：静态审计完成；安全整改方案待确认；不具备本任务的上线验收条件。

## 1. 审计基线与限制

本报告以当前本地工作区（包含既有未提交、未跟踪改动）为基线，不代表 GitHub 或任何服务器的现状。既有改动涉及 Amazon 同步中心、凭证入口、schema、五个相关迁移、worker、商品域、浏览器测试和文档；存在 `.next-amazon-live/` 构建产物。同步前必须重新完整盘点，不能将本报告或后续单点修补视为整个改动区已验证。

本次仅阅读代码、迁移和测试并生成方案。未读取私有环境文件、未解密凭证、未连接实际数据库/Redis、未调用外部 API、未运行 worker/迁移/部署，也未提交或推送。历史数据的实际行数、真实归属异常、已应用迁移和线上权限均未核验，不能给出“历史数据安全”结论。

## 2. 已有能力、实际入口与缺口

| 项目 | 真实实现与调用链 | 结论 / 缺口 |
|---|---|---|
| 组织和工作区 | `auth/api-permissions.ts` → session、模块 RBAC、`workspace/access.ts`；后者仅检查组织内 WorkspaceScope 存在 | 组织隔离已有基础；不等于个人工作区授权。Amazon 普通成员的有效范围依赖显式店铺 grant |
| ERP 店铺 | `prisma/schema.prisma` 的 SellerAccount：displayName、accountKey、marketplaceCode、marketplaceId；唯一键为 org/workspace/accountKey/marketplaceCode | accountKey 不是已验证 Seller ID；不能用昵称或 accountKey 证明 Amazon 身份 |
| 多凭证 | AmazonSpApiAuthorization 按 org/workspace/Seller ID/region 唯一；`amazon-sync/service.ts::saveAuthorization` 经 approvedContext 和管理员校验，加密上下文绑定授权 ID | 相比旧单凭证模型可支持多个 Seller；Seller ID 仍来自请求字段 |
| 授权验证 | `performAuthorizationValidation` → LWA token → Sellers marketplaceParticipations → 保存站点与状态；验证失败脱敏审计 | 此调用只证明凭证能读参与站点，代码未将返回结果与录入 Seller ID 做身份绑定。不能标称“真实 Seller ID 已识别” |
| OAuth | 全仓检索 OAuth callback、selling_partner_id、spapi_oauth_code 未发现 Amazon 授权回调入口 | 需补完整 state/会话/区域/租户绑定、单次 code 兑换、幂等与身份确认；实施时核对官方接口能力，不假设 marketplaceParticipations 会返回 Seller ID |
| 凭证安全 | `amazon/integration-secrets.ts`、SP-API client；旧 credentials/bindings routes 已返回 410，旧同步执行器 inert | 保留现有加密边界，不能恢复退役入口或共享旧凭证实现 |
| 数据源身份 | AmazonSyncDataSource 关联 scoped SellerAccount/Authorization，按 org/workspace/seller/marketplace/resource 唯一；`saveSource` 校验参与站点、同授权同站点同域重复映射 | 尚无跨域一致的 ERP 店铺与 Amazon Seller 身份约束，见 F3 |
| 运营店铺授权 | AmazonDataAccessGrant，复合 FK 约束成员/工作区/店铺；`data-access.ts` 每次查 active 成员和当前 grant；`saveAccessGrant` 走审批、CAS、事务审计 | 用户→店铺 enabled 已有；缺 Marketplace、动作和角色授权粒度；owner/database_admin 直接 allSellers |
| 已接入的读路径 | `read.ts`、`snapshots.ts`、`sales-query.ts`、`operations/amazon-products.ts`；sync-center Route 传真实 actor，Prisma WHERE/SQL 加店铺范围 | 主路径已具基础隔离；显式请求未授权 seller 部分返回空集而非统一拒绝；低层 SQL 构造函数权限参数可省略，不宜直接暴露给新工具 |
| 汇总 | readOverview 的 SQL 限定允许 sourceIds；inventory compatibility 汇总来自授权 published heads；商品投影用 seller+marketplace+SKU 复合 key | 这些路径没有发现仅凭 SKU 合并不同店铺的实现；不代表 CLI/其他域也安全 |
| 异步同步 | service 创建冻结范围与审批，processor::assertLiveSource 重查 actor/approver、scope、revision、Seller grant、执行窗口；scheduler 分发已有意图 | 已实现关键复核机制；补货历史分支未同样覆盖，见 F4 |
| 销售版本与导出 | SalesTraffic 为店铺逐日总量；`exports.ts` 冻结 seller 范围、执行时和分批复核、限 100k 行/64MB；专用下载 Route 在取存储后重验 | 已有撤权防线；仍需真实 DB 的普通运营多店测试。管理员无显式 seller 的导出使用 `_scopeAll`，MCP 不可沿用该放大规则 |
| 同步来源 | SyncRun、TaskLog、source、sales reportId/documentId、capture/publish 时间；UI 区分缺数据 | 可复用；库存/Listing requestId、逐页日志完整度还需专项核验。不能称快照为实时 Amazon 数据 |
| MCP | `integrations/sellersprite.ts` 是访问卖家精灵的出站 MCP 客户端；Agent 内 Product/Listing/Supplier 的 McpAdapter 是运行时适配器 | 未发现本 ERP 面向运营的独立入站 MCP 服务、凭证表或统一逐调用授权链。适配器名称含 MCP 不代表已实现目标能力 |
| 审计 | AuditLog、ChangeRequest、TaskLog 和导出事件 | 配置/审批/部分同步已有审计；一般数据读取、拒绝、管理员跨店和 MCP 调用不具备统一 requestId/范围/结果审计闭环 |

## 3. 安全发现与优先级

### F1（P0 整改优先）：补货 API 绕过 Seller grant

路径：`src/app/api/operations/replenishment/route.ts` GET/PATCH。

GET 在 operations:view 后，按组织/工作区直接返回所有 policy、SellerAccount 和关联 plan。PATCH 在 operations:edit 后，仅检查目标 SellerAccount 属于工作区，不调用 amazonDataAccess/assertSellerAccess。具模块权限但未获店铺 B grant 的普通成员，可以读 B 的策略/计算输入和修改 B 的策略。该问题可由代码链路确认；本次没有请求真实接口验证或断言线上可利用性。

修补需在查询前解析当前访问范围，WHERE 内约束 policy、seller、plan；PATCH 在写事务内检查目标 seller、Marketplace 身份和 edit 权限，记录审计。不得查询全店后在 JS 过滤。拒绝和不存在使用统一、不泄露身份的响应。

### F2（P0 整改优先）：Ops CLI 的模块权限不能代替店铺授权

路径：`src/lib/operations/cli.ts::authorizeOps/runOpsCommand`。

authorizeOps 检查 active 成员、组织工作区和模块权限，但不读取店铺 grant；runOpsCommand 的 latest、inventory/catalog、inventory aggregate、sync runs 只带 org/workspace。能运行该内部 CLI 并绑定普通成员身份的调用方，可读取该成员未获店铺授权的数据。CLI 当前是本地可信进程，未发现它已作为远程 MCP 暴露；不能将此事实夸大为已存在远程 MCP 漏洞，也不能将其接入 MCP。

修补需实际查询直接限店铺/站点，只读事务内解析权限；使用已发布、归属可证的数据源范围；旧 sourceId/seller 为空的任务不得退化到全工作区读。PPC suggest 的库存新鲜度查询也须限范围。

### F3（高）：授权可验证站点，尚不可证明 Seller 身份一致

路径：`saveAuthorization`、`performAuthorizationValidation`、`saveSource`。

录入 Seller ID A 后，用 B 的有效 refresh token 验证参与站点，当前验证不比较真实 Seller ID；FBA inventory 调用也不依赖 URL 内 Seller ID。另一个风险是同一 ERP seller+Marketplace 的不同资源可绑定不同 authorization：saveSource 的 duplicate 检查仅针对同 authorization/Marketplace/resource，不保证跨域身份一致。因此错误配置可能让 A 的 catalog 与 B 的 inventory 在同一 ERP 店铺下组合，grant 本身不能修复错误身份。

应增加可验证的 OAuth 身份证据和跨域 Seller/Marketplace 绑定一致性。未经证实的旧授权标记待核查，禁止静默认证为可信。Marketplace ID 在业务模型可能是 Amazon 官方 ID 或本地 Marketplace FK，必须显式映射，不能直接等同。

### F4（高）：补货历史分支未在执行时复核操作者授权

路径：`operations/replenishment-service.ts::refreshDueReplenishmentPlans`。

Amazon 分支调用 readAmazonProductsForSkus，传 updatedByUserId；historicalSource 分支直接读 sellfox_sales_daily / sellfox_inventory_current，仅检查报表店铺在当前 org/workspace，没有在执行前校验 active 成员、当前 Amazon Seller grant 和 sellfox 模块权限；最终 plan 发布事务也未统一重验这组权限。撤权后该分支仍可能继续生成派生计划。

修补应复用当前创建者身份，读前及发布前复核双方来源权限和明确店铺映射；权限失败不得发布旧数据或含敏感输入的新成功结果。不要把 Amazon grant 推定为 Sellfox 店铺授权。

### F5（高，相关历史导出边界）：通用 ImportJob 下载仅限定组织

路径：`src/app/api/files/[id]/download/route.ts`。

此 ID 是 ImportJob ID，不是 AmazonDataExport/fileId；当前不是销售 JSONL 专用下载的直接绕过。该 Route 只限制 job/file organizationId，未限制操作者/工作区/店铺，持有 workspace:export 的同组织用户若知道其他工作区 job ID，可能下载其 optimized workbook。PPC 导入尚无可靠店铺绑定，此路径必须纳入历史广告文件隔离整改；不能声称 dedicated sales export 的二次校验覆盖了它。

### F6（高）：身份、授权和审计还不能满足 MCP 验收

现有 grant 无动作、Marketplace 或角色维度；管理员直接全店；MCP token hash、有效期、撤销、rotation、tool allowlist、显式店铺上限、调用审计均未建立。通用模块 RBAC 与用户店铺 grant 的组合可作为基础，但不可直接当成 MCP 授权结果。

## 4. 数据域和历史归属

| 域 / 模型 | 当前归属与风险 | 后续处理 |
|---|---|---|
| AmazonInventorySnapshot | org/workspace、可空 seller、marketplace、run；旧数据可能无 seller，未以 FK 证明完整范围 | 只允许来源链一致的已发布数据；无法证实归属的旧行隔离，不按 SKU/ASIN 推测 |
| AmazonCatalogSnapshot | org/workspace/seller/marketplace/sourceRunId；部分关系为标量 | 校验 source/run 与行范围一致，考虑必要的复合约束 |
| AmazonSalesTrafficSnapshot | source/run 复合 FK、seller、marketplace、date、report/document | FK 证明 source/run，但未单独约束 row seller/marketplace 必然与 source 相等；需要一致性扫描和可行约束 |
| AmazonReplenishmentPolicy/Plan | org/workspace/seller/marketplace/SKU，有第三方历史来源引用 | 修复 F1/F4，避免不同来源店铺未经映射组合 |
| ProductListing / ProductRecord | Listing 的 seller/marketplace 可空；ProductRecord 是商品主档事实源 | 商品主档不强制变成单店商品，不由 SP-API 覆盖；仅把已明确归属的店铺业务投影纳入统一访问边界 |
| WorkspaceDataset / FileObject / ImportJob | Dataset 有 org/user/workspace/accountId/marketplace，未形成可信 seller 关系 | 广告上传是独立来源；未认证 accountId 不作为 grant；未归属记录禁止向普通 MCP 输出 |
| SellfoxStore、库存、日销、广告、利润视图 | 独立 storeId、org/workspace 报表域；非 SellerAccount 的同义词 | 先建立可审阅身份映射；保留利润 onlySettle 分区、币种和缺失值口径；本次不重建已有报表 |
| 订单 / 财务 / fulfillment | 同步中心域定义/阻塞状态不等于已实现数据采集器 | 未发现本次目标所需的完整 SP-API 订单/利润实现；不得用 Sellfox、上传或估算冒充实时 SP-API |

历史实际问题尚待数据库盘点。迁移工具应默认只读 dry-run，输出精确范围、可证映射、待核查与冲突数量、证据 source/run/auth、异常 ID；输出不含凭证。写入版必须另行批准 org/workspace/操作者/记录集合与报告摘要哈希，CAS 防覆盖、可重跑、事务审计。待核查数据保留原样，默认不可被 MCP/普通运营读取。

## 5. 拟实施权限合同（待确认）

沿用 PostgreSQL、OrganizationMember、WorkspaceScope、SellerAccount、AmazonDataAccessGrant、AuditLog、审批和存储适配器，逐步扩展 `amazon-sync/data-access.ts` 为统一权限入口，不再另建平行事实源。

ERP 请求使用 session 的 user/org，MCP 使用已验证凭证绑定的 user/org/workspace；请求参数仅作为缩小范围的筛选。统一 scope 包含 seller+Marketplace+action，不提供公开 allSellers 默认值。读取、写入、聚合、分页、关联和导出必须在 SQL/Prisma WHERE 施加该 scope。未授权与不存在使用一致拒绝，日志保留可排查原因。

MCP 最终范围 = 当前 active 成员的显式 ERP grant ∩ 凭证 seller/Marketplace 上限 ∩ tool/action allowlist。即使绑定 owner 也不走 ERP allSellers 分支。未指店铺时单店默认，多店只在 tool 明确支持授权范围汇总时允许，否则要求选择；数组逐个校验，禁止默默忽略越权项。

新增 MCP 凭证独立模型：安全随机密钥仅展示一次，保存哈希、可识别但非机密前缀、绑定身份、tool/scope、状态、expiry、creator/lastUsed、rotation 关联。每次请求查当前凭证和 grant，默认不跨请求缓存权限；若引入缓存，必须具备权限版本/撤销即时失效，不能用 TTL 作为即时撤权替代。

暂不引入 RLS：先补应用层缺口。后续只在事务级租户上下文、连接池语义、后台任务、DB role/BYPASSRLS 与回滚专项验证后评估，不能直接对全库启用。

## 6. 分阶段变更与审批边界

### S0：先堵已有高风险路径（建议首批批准范围）

- 修改范围：补货 Route/service、Ops CLI/ppc-read、通用 ImportJob 下载 Route、既有 data-access，必要的关联测试与本报告。不修改商品事实源或业务算法。
- 行为：普通成员只读写明确授权店铺；CLI 不读取归属不明旧快照；撤权任务停止读取/发布；下载按实际 job 所有权/工作区收紧，未经证明的共享文件拒绝而不推测归属。
- 数据库：本批不新增 schema/迁移，不执行现有迁移，不回填历史数据。隔离测试可在一次性空库应用现有五项迁移，使用合成组织/A/B/跨工作区/跨组织记录，Amazon transport 全部模拟。
- 影响：收紧旧读取行为，部分过去可见的跨店策略、旧 CLI 结果和共享导出将拒绝。每个操作新增成员/grant 查询，可能增加 DB 往返；优先单次解析在请求/事务内复用，不增加后台全量扫描。无真实性能测量前不承诺 P95。
- 回滚：撤回本批代码可恢复旧行为但重新暴露漏洞；推荐失败时关闭相关入口，而非恢复宽权限。无数据逆迁移，不触碰真实配置。
- 验证：真实 service/Route + 隔离 PostgreSQL WHERE/aggregate/download 路径，覆盖 A/B 同 SKU、无 grant、撤权、跨 org/workspace、未知/未授权等价响应；`check:fast`。测量新增查询次数和隔离延迟，明确不等于生产 P95。

### Phase 1：身份和授权列表

先核对官方 OAuth 与身份获取合同，再写 state/会话/一次兑换和回放防护、授权唯一键、credential revision；保留显示名与官方身份区别。增加明确身份绑定、可信来源证据、授权人/时间/状态；现有配置导入不得自动升级为身份已证实。UI 扩展搜索/筛选、详情、改名、授权人数/日志。凭证不向客户端回显。

### Phase 2：统一数据范围与历史隔离

将 S0 之后剩余查询/写入/导出/job/文件入口逐一接入统一 scope；补跨域身份一致性。提供 dry-run 异常报告，复合约束先在空库和含旧记录 fixture 演练；待核查数据保留并默认拒读。后续迁移只增量、先加可兼容字段后经批准回填，验证后再强化约束。

### Phase 3：运营授权粒度与审计

扩展现有 grant 支持 Marketplace/actions 和角色策略；角色授权继承与用户授权合并语义须写入合同。owner/database_admin 的 ERP 跨店特例显式审计，MCP 无此特例。撤权、CAS 和审批结果在一个事务，统一 requestId/actor/scope/outcome/拒绝码，不记录 token 或整段敏感输入。

### Phase 4：独立 MCP 入口

先只开放已实现的 list stores、catalog、inventory、sales_traffic、sync status 和受控 export。订单、利润、广告等缺可信归属或未接入域明确不支持。每个 tool 只调用既有真实 service 和统一 scope，不自行拼未认证查询。创建、轮换、禁用、撤销 API/UI 经已有管理审批；密钥仅创建时返回一次，使用记录脱敏。写/同步工具在相应 ERP action 和现有审批可证明前保持关闭。

### Phase 5：上线准入

在真实 DB 查询链上逐项通过任务要求的 15 项安全矩阵，包括 token 撤销、ERP grant 撤销、异步执行和发布、聚合/分页/导出/关联、跨 org/workspace/Marketplace、缺归属、未知店铺响应等价。补充轮换、expiry、禁用用户、管理员 MCP 不扩权、双店同 SKU、来源错配、分页途中撤权与审计不可用行为。并发撤权定义为撤权事务提交后新调用失效；在途请求/任务在返回或发布前复核。

生产 DB/外部 OAuth 联调/凭证签发/真实 grant 修改/配置启用/发布分别提交精确方案并获得批准；不将本地代码批准解释为真实执行批准。正式同步需先审阅当前全部改动区；CI 完整 check/build/artifact 链验证后，才评估发布。迁移采用前滚兼容和保留数据的应用回滚，不自动删表/恢复旧 DB。

## 7. 本次交付与验证结果

- 修改文件：仅新增本报告；既有应用、schema、迁移与配置保持本次读取时的内容。
- 数据库迁移：未新增、未运行；既有 `20261105000000_amazon_data_access_grants` 的本轮执行结果未知。
- API/MCP：本次无契约变更；上文是待批准方案。
- 验证：已逐条阅读主读/写/导出/worker/CLI/身份路径，检查测试实现。`amazon-production-boundaries.test.ts` 使用 fake Prisma 对象，其结果不能代替真实 SQL 安全验收；已有同步集成 fixture 的操作者主要为 owner，不足以证明普通运营隔离。
- 自动化运行：本轮未运行测试、typecheck、lint、构建或集成环境，因为未修改执行代码；后续 S0 按相关安全集成 + check:fast 验证。完整 check/构建留待合码准入；真实 API 与生产验证需独立批准。
- 未解决：F1–F6、官方身份合同、全部历史数据实际归属、跨域映射、独立 MCP 身份和安全矩阵，均未宣称完成。
- 部署条件：不具备。本报告不是生产漏洞复现、迁移验收、性能证明或上线批准。

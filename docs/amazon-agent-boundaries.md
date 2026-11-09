# Amazon 专项开发与历史边界


<!-- AGENTS migration 2026-11-08: original lines 322-332 -->
## Amazon 数据同步中心审批

- 支持单管理员流程：当前组织有效 `owner` / `database_admin` 在具备 `operations:approve` 和原有业务权限时，可批准自己的申请；普通成员仍不得自行审批。角色与权限必须在服务端从数据库实时读取，不接受客户端声明。
- 保留申请、脱敏审阅、批准、独立应用、revision、有效期、范围和审计校验；批准不等于应用或启动任务。批准审计记录 `selfApproved` / `approverRole`，不自动批准既有申请；其他业务模块的审批规则不变。

### Amazon Orders P1/P2 离线开发边界

- `orders` uses Orders v2026-01-01 `searchOrders` plus optional approval-bound `getOrder` detail. Each job resumes a bounded cursor; page/work/fact/raw commits are idempotent and raw PII remains AES-GCM encrypted. Amazon documents say v2026-01-01 Orders PII does not require RDT; do not create or reuse a v0 Tokens path. PII datasets require explicit business-purpose and restricted-role attestation; standard queries/UI expose no PII or raw envelopes. Official pages: `https://developer-docs.amazon.com/sp-api/reference/getorder-3`, `https://developer-docs.amazon.com/sp-api/docs/access-orders-pii`.
- `npm run test:amazon-orders:offline`: disposable preinstalled Docker PG/Redis + `.invalid` fixture HTTP + order browser; no inherited credentials/database config, dotenv, image pulls or real sync. `npm run test:amazon-sync:offline` includes existing sync regressions. Specs, validation, and remaining financial/returns gates: `docs/amazon-orders-p1.md`, `docs/amazon-orders-p2-plan.md`.
- Amazon 角色仅记录管理员核实的 attestation，不把 Marketplace 参与资格当作 Orders 域权限证明。非敏感 applicationId/预算同应用跨站点一致；新数据仍隔离 organization/workspace/seller/site，不改 ProductRecord 或 PPC 存储边界。


<!-- AGENTS migration 2026-11-08: original lines 425-446 -->

历史接入阶段记录：“仅 inventory/catalog 已实现”不代表当前全部适配器范围。当前自动发现与调度规则查 docs/amazon-automatic-sync.md 和相应实现；出价写入的 NOT_IMPLEMENTED 闸门仍须保留。

## 经营中台定时同步

- `/operations?tab=sync` 计划按组织/工作区/域隔离，默认关闭，仅 inventory/catalog 执行器已实现；启用仍需明确的服务端授权映射。
- `npm run worker:amazon-sync` 运行专用 Amazon 只读队列和 30 秒计划检查；不由页面启动调度器。
- 生产专用服务为 `amazon-sync-worker` systemd unit；部署计划仅在 worker 入口/共享依赖/schema/迁移/unit 变化时重启它。
- `npm run test:operations:browser` 在隔离模拟接口中验证六域状态、缺失值、计划控件、手动同步和切 workspace 迟到响应；不需要账号，不访问真实 Amazon，不替代服务端权限/真实数据验收。
- 计划、幂等、防重与验收说明见 `docs/amazon-operations-hub.md`。新增计划表后先按受控迁移流程应用，禁止在代码任务中自动迁移生产。

### Amazon 刊登与补货扩展

- Amazon 自动同步保持独立快照；`SellerAccount.accountKey` 不是默认 Seller ID。服务端显式配置 `AMAZON_SP_API_SELLER_BINDINGS`，只允许实际授权的 inventory/catalog；缺配置 BLOCKED。
- Product Center 只附加当前页的只读 Amazon 投影，禁止写入 ProductRecord；补货策略/建议为独立表，不自动生成采购单。
- 专用 Amazon worker 同时处理每日补货重算。真实销量缺日、缺周期或库存 STALE 时必须 NEEDS_DATA；ERP 历史来源按精确 MSKU，禁止将导入缺省零当真实零。

### 内部 Ops CLI 与 Amazon 出价审计

- `npm run ops:cli -- --help`：仅本机进程读取本地数据库；OPS_CLI_ORGANIZATION_ID / ACTOR_USER_ID / WORKSPACE_IDS 绑定身份与范围，检查 active 成员及模块权限，PG READ ONLY 事务禁止隐式写库。CLI 不直接请求 Amazon、不触发同步、不写 ProductRecord。
- `ppc suggest` 复用现有分析工具，只输出报告/草稿；PPC 日指标缺可靠 SKU/ASIN 日期映射时保持 null/说明。
- Amazon 出价动作经 AmazonAgentActionAudit preview → 既有 approvals confirm → audit apply，组织/工作区、30 分钟到期、幂等和批量/出价限制均由服务端检查。
- AMAZON_ADS_EXECUTION_ENABLED 默认 false；当前 true 仍明确 NOT_IMPLEMENTED、整批零 HTTP，禁止标为 APPLIED。实现真实 transport/profile/实体授权映射并完成受控联调前，不得仅靠开关或删除闸门上线。
- CLI 命令、配置、API、stub 契约、验证边界和回滚见 `docs/amazon-operations-hub.md`。


<!-- AGENTS migration 2026-11-08: original lines 486-551 -->

以下 Phase 1～P5、历史验证数字和批准范围属于阶段记录，不证明当前代码或生产已验收，也不授予本次真实操作权限。旧“缺省关闭／仅 US CA／不含退货／不开放持续采集”等范围与当前自动同步规则冲突时，以 docs/amazon-automatic-sync.md 的最新章节及当前 policy/scheduler 核验为准；手动任务审批、敏感数据保护和租户隔离约束继续有效。

## Amazon 同步中心 Phase 1 试点

- 复用现有 AmazonSyncSchedule / AmazonSyncRun / BullMQ / amazon-sync-worker；仅 FBA inventory 与 Listings Items catalog 已接入。ProductRecord 不被外部同步覆盖，赛狐指标独立。
- `AMAZON_SYNC_CENTER_SCOPES` 为组织＋工作区精确二元数组 JSON，缺省关闭；web 与 worker 必须一致。启用前停止旧计划并排空旧任务，显式导入／验证授权，不自动推断 Seller ID。
- `npm run test:amazon-sync:integration` 使用预装官方 Docker 镜像建立独立 PostgreSQL／Redis，一次性验证真实迁移、队列和恢复；Amazon 响应模拟，不调用生产。脚本不拉取镜像，不接触既有容器。
- `npm run test:amazon-sync:browser` 为真实 Tailwind 样式、模拟 API 的隔离浏览器回归。
- 本轮包含 schema 扩展；关闭试点需保留兼容新唯一键的应用，禁止任意回滚到迁移前应用或自动删表。部署／回滚、验证限制见 `docs/amazon-sync-center-phase1/`，未明确要求不得执行生产迁移或发布。

## Amazon SP-API 本地真实联调

- 2026-11-05 默认库存/Listing 隔离集成已获单独批准并通过 16 项（真实 fixture PostgreSQL/Redis、审批 Route Handler、测试 Worker、Chromium，Amazon transport 模拟），临时资源已清理。记录：`docs/amazon-sync-default-isolated-verification.json`。不代表真实 Amazon 或生产性能验收。

- 日期/Reports 销售流量、版本查询/导出、商品观察字段写入保护的本地增量边界见 `docs/amazon-sync-center-phase2-development.md`。销售数据为店铺逐日汇总，缺失/未闭合报告不发布为完整；单独获批的临时空库迁移/SQL 及销售审批→测试 BullMQ consumer→发布→查询→本地导出下载集成已通过（Amazon HTTP 模拟）。现有环境迁移和真实联调仍须逐项审批，旧集成通过记录不代表当前代码已验收。

- `node scripts/amazon-sync-live-preflight.mjs`：复用统一 runtime loader，只检查环境配置并输出脱敏结果，不连接数据库／Redis、不解密、不请求 Amazon；退出 2 表示未就绪，退出 0 不能代表真实验收。拒绝替代 env、冲突继承变量及退役 profile；生产注入配置不会通过本地联调验收检查。
- `node --test tests/amazon-sync-preflight.test.mjs`：预检脱敏与拒绝非本地配置的专项测试。
- 操作与未填真实结果记录见 `docs/amazon-sync-center-phase1/live-validation.md`。共用 Amazon Worker 会扫描旧计划及补货到期任务；历史上使用的独立本地数据库/Redis 配置不能作为当前流程继续切换目标。联调前先完成根 `.env` 的目标库身份与数据范围审查；不使用测试 fixture 或生产隧道，不制造真实限流。

- 历史 Amazon 本地联调说明与结果见 `docs/amazon-sync-center-phase1/local-environment.md`。其中提及的私有 `.env.amazon-live.local`、`DOTENV_CONFIG_PATH` 与独立本地服务属于旧配置路径，不得作为常规 app/worker 配置入口；如仍需联调，先只读核实进程及数据库/Redis身份，再按本节完成配置归并方案与数据/密钥影响审查。不得把空授权环境就绪表述为真实 Amazon 验收通过。

## Amazon ERP 生产准入补充

- `node scripts/test-amazon-sync-integration.mjs --security`：一次性 PostgreSQL/Redis 和本地临时存储的多店铺安全回归，验证补货、只读 CLI、撤权及导入结果下载；不访问真实 Amazon，不替代 MCP/OAuth 验收。S0 范围、兼容性和验证结果见 `docs/amazon-multistore-s0-delivery.md`。

- 成员 Workspace/Seller 数据授权、24 小时人工任务执行窗口、受控 Worker 的本地代码边界及生产门槛见 `docs/erp-production-readiness-plan.md`。普通成员无显式授权拒绝；旧无执行期限任务/旧无范围导出须重新批准/申请，不自动回填权限。
- `AMAZON_SYNC_WORKER_MODE=approved-only` 配合 JSON `AMAZON_SYNC_WORKER_TASK_IDS` / `AMAZON_SYNC_WORKER_EXPORT_IDS` 只处理明确 ID、使用独立队列且不刷新补货；默认 standard 保留原行为。真实配置和启动仍需单独审批。设置页标准队列心跳不代表受控队列在线。
- 隔离 runner 当前包含第五迁移 `20261105000000_amazon_data_access_grants`；2026-11-05 单独获批后，销售 SQL 4 项、销售链路 1 项、默认库存/Listing 16 项均通过，临时资源已清理。记录见 `docs/amazon-sync-access-grants-isolated-verification.json`；不代表现有库迁移或真实 Amazon 验收通过。

## Amazon 多店铺身份与个人 MCP

- 本地交付与生产门槛见 `docs/amazon-multistore-delivery-2026-11-05.md`；验证清单见 `docs/amazon-multistore-verification-2026-11-05.json`。隔离 runner 增加第六迁移 `20261105010000_amazon_multistore_mcp`；新增 SQL 不能据此视为已应用到现有库。
- `node scripts/test-amazon-sync-integration.mjs --mcp`：真实临时 PostgreSQL / Redis 的个人凭证、当前 ERP 用户/角色/站点/操作交集、OAuth、审批及并发撤权回归；所有 Amazon HTTP 模拟。
- MCP 入口为 `/api/mcp/amazon`，凭证绑定个人且只在创建/轮换时展示一次。ERP 管理员身份不隐式授权 MCP，旧 grants 的 `mcpEnabled` 默认 false。凭证页面在同步中心“同步设置”；店铺及角色范围在“店铺与授权”。
- OAuth 使用固定登记 callback、单次 state 及卖家范围验证；参与站点不能单独证明 Seller ID。OAuth 配置变量名及历史数据核查/回滚规则见交付文档，不在仓库保存真实值。
- `npx tsx scripts/audit-amazon-lineage.ts --report-only --organization-id=<id> --workspace-id=<id>` 是有界只读归属报告，不加载 `.env`，不按 SKU/ASIN 推测或自动回填。连接真实目标前仍须具体审批；截断/异常退出 2，不能当作全库核查完成。
- 主要 ERP 读取入口与 MCP 有 append-only 审计；CLI 业务查询仍在 READ ONLY 事务中，输出前在事务外追加读取审计。不得为写审计放宽业务查询范围。

## Amazon 财务 P3 本地实现边界

- Finances v2024-06-19 只使用 `listTransactions`，复用现有审批 / service / processor / SP-API client。`financePolicy` 明确卖家级范围、全部验证站点、时区、窗口、预算和可选 FX；source marketplace 仅为管理锚点，不是返回行的默认归属。
- 财务采集及查询当前限实时 owner/database_admin，仍须逐次范围审批和每站点有效绑定。site-only grant / MCP 不暴露财务 source、run 或 raw。缺角色或范围变化在 HTTP 前阻断；落库前再次检查。
- 金额保留 JSON number 原文并使用 NUMERIC，不经 JS Number；未知归属加密隔离，查询排除；不把完成 posted 窗口称作结算完整。生产不提供 raw 自动重放入口。
- `npm run test:amazon-finance:offline` 运行 fixture 单测、临时 PG/Redis 集成与浏览器验证；`npm run test:amazon-sync:offline` 扩展旧三链路及 Orders 回归。均不加载真实 dotenv 或运行真实任务。详见 `docs/amazon-finance-p3-plan.md`、`docs/amazon-finance-p3-validation.md`。P4 须阶段确认后推进。

## Amazon 退货 P4 本地实现边界

- P4 仅 FBA 仓收退货，复用 Reports v2021-06-30/client/processor/审批；reportType 仅由 `returns.ts` 枚举及批准策略 allowlist 提供。Pricing 或 Amazon Fulfillment 角色须已确认；本报告非受限类型，不申请 RDT。不借此允许其他报告类型。
- `returnsPolicy` 明确窗口、站点时区、至少一天安全延迟、三操作预算、轮询上限和解析批次。cursor 的 `reportStateCiphertext` 保存报告/文档/原件/行 offset；每批明细和 cursor 同事务；未知 create 结果停下人工核查，不能重放创建。404 轮询与过期下载 URL 走有界退避。
- 单份已发布报告为查询边界；`reportId + rowHash` 仅报告内幂等，不能跨报告累加当独立退货事件。原因维度保留原始代码，订单关联限 tenant/seller/site/authorization，不造订单，不修改库存/财务。原件仅加密归档，评论/商品自由文本不进普通 DTO/日志/UI；无 offset 日期 fail closed。
- `npm run test:amazon-returns:offline`：fixture 单测、临时 PG/Redis、退货及订单/财务浏览器；全资源回归 `npm run test:amazon-sync:offline`。不得读取真实 dotenv、启动真实 job 或执行真实迁移。计划/官方依据/验收见 `docs/amazon-returns-p4-plan.md`、`docs/amazon-returns-p4-validation.md`。P5 仍需阶段确认。

## Amazon 同步 P5 生命周期与观测

后续用户已批准 US/CA 自动同步范围，当前持续调度规则见 `docs/amazon-automatic-sync.md`：有效授权和数据源就绪后系统建计划，订单／日报／财务最多回溯 730 天，再每日增量，商品／库存每日快照。P5 下述逐次审批描述保留为手动任务历史边界；自动任务由实时启用计划、revision、角色、数据源与授权共同控制。退货未纳入自动计划。新增计划约束迁移须随版本经 CI 发布，不得只推 worker 而遗漏迁移。

- P5继续逐次审批窗口，不开放自动持续采集。新三资源的异常/控制状态经 `service.ts syncIncrementalCursorStatus` 在scope锁及run变更同事务更新；只改匹配source/resource/activeRunId且未SUCCEEDED的cursor，禁止清空watermark/token/reportState/成功水位。健康窗口RUNNING与run等待片段状态语义不同，不强制逐片同值。
- scheduler租约恢复与执行审批阻断、processor执行前阻断/运行中pause/cancel、service显式resume/retry须遵守该边界；旧三链路保持原调度/重试/预算。Finance/Returns使用独立校验码，Orders旧码兼容。
- source进度DTO只select资源/窗口/status/lastSuccessAt/updatedAt；任务提示只允许固定文案，不得输出token/密文/raw/签名URL/PII。现有tenant/seller/site过滤和财务管理员边界不可放宽。
- 专项 `npm run test:amazon-sync:lifecycle`，完整 `npm run test:amazon-sync:offline`；前者仅新建临时PG/Redis与mock transport。运维、角色/额度、轮换、恢复及告警边界见 `docs/amazon-sync-p5-operations.md`；P5不新增迁移、端点或真实配置操作。

## Amazon API 参考文档

- 查阅 SP-API 配置或接入说明时，优先参考本机文档 `/Users/chenjieliang/Desktop/亚马逊SP-API新人配置指南.md`。
- 查阅 Amazon Ads API 配置或接入说明时，优先参考本机文档 `/Users/chenjieliang/Desktop/Amazon-Ads-API-单配置.md`。
- 以上文档仅作为配置与接入参考；任何真实凭证、外部 API、配置写入或生产操作仍须遵守本文件的长期安全审批规则。


<!-- AGENTS migration 2026-11-08: original lines 552-556 -->

已退役的历史单项例外，仅留追溯：2026-11-07 根 .env 切换后，scripts/runtime/environment.mjs 已拒绝任何 ERP_LOCAL_INTEGRATION_PROFILE。下述 2026-11-06 批准不得用于当前启动或重开旧配置。

### 2026-11-06 Amazon 四域独立本机联调例外

用户已明确批准本轮恢复隔离注册入口：仅显式 `ERP_LOCAL_INTEGRATION_PROFILE=amazon-live-approved`，固定 `.env.amazon-live.local`、PG127.0.0.1:55439/amazon_sync_live_local、Redis127.0.0.1:6399/db0及amazon-live-local/default。loader不合并根.env，拒绝生产模式、发布构建及继承目标冲突。此为既有真实隔离联调的单项批准，不是常规app/worker第二配置入口；不得据此扩大组织、端口、密钥或服务器范围。

私有启动器须经 `scripts/runtime/worker-manager.mjs amazon-sync`，保留注册child、IPC归属及同目标锁；不得直接启动child规避manager。运行态核验须同时看真实进程、最新online心跳及queueReady，不能用spawn成功替代上线验证。未批准的新恢复动作仍需按长期审批规则逐项审阅；财务同窗口重放、结算分段续传的批准与实际执行结果以 `docs/amazon-four-domain-repair-delivery-2026-11-06.md` 最新记录为准。

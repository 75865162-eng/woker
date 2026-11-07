# Amazon 同步中心：本地增量交接（2026-11-04）

本记录对应用户批准的日期、Reports、查询导出、审批和商品保护本地代码范围。用户随后单独批准并完成临时空库迁移/SQL 验证。**没有修改现有数据库，没有执行真实 Amazon 请求、真实配置写入、生产任务、推送或部署。隔离验证不能作为真实 Amazon 验收。** 工作区原有 Phase A/B、审批和联调资料改动全部保留；本记录优先说明本轮实际能力，不沿用旧交付记录推断当前集成通过。

## 数据域现状

沿用现有授权、源、审批、任务、队列、Worker 和 RBAC，没有创建第二套架构。

| 数据域 | API / 粒度 | 状态及限制 |
| --- | --- | --- |
| 库存 | FBA Inventory v1 / getInventorySummaries；SKU 快照 | 保留真实 transport，强化分页及重复校验；不支持历史日期回拉 |
| Listing | Listings Items 2021-08-01 / searchListingsItems；Seller SKU 快照 | 保留真实 transport，强化站点/字段校验；不支持历史日期回拉 |
| 销售流量 | Reports 2021-06-30 / GET_SALES_AND_TRAFFIC_REPORT；店铺 × 业务日 | 新增创建、轮询、下载、解析、发布、查询和导出代码；尚未真实调用 |
| 订单 | Orders | 本轮未实现 |
| 财务结算 | Finances / Reports | 本轮未实现 |
| 广告 | 独立 Amazon Ads API 和授权 | 本轮未实现；不能用 SP-API 授权替代 |

接口依据沿用 [API 盘点](amazon-sync-center-phase0/api-domain-matrix.md) 和 [官方模型证据](amazon-sync-center-phase0/official-model-evidence.json)。销售报告需要 Seller 的相应销售流量/Reports 角色、有效授权和支持站点；真实权限与可用性仍待受控核验。不会将多日 ASIN 汇总拆成虚假的每日 SKU 指标。

## 日期、获取和版本

- `date-range.ts` 在申请审批时按 Marketplace 业务时区冻结范围。业务结束日包含在内，内部保存 UTC end-exclusive，真实请求使用冻结的 startAt/reportEndAt。
- 支持今天、昨天、近 7/30 天、本月、上月、自定义。保守限制每次 31 天、历史 730 天；未知时区拒绝申请。包含当天的报告截到申请时间，标记未闭合，不能作为完整业务日发布。
- 销售域只允许人工指定日期申请，暂不支持定时全量/增量。库存与 Listing 的日期查询是已存快照观察时间/来源更新时间，不能表述为历史回拉。
- `sp-api-client.ts` 使用现有区域 Endpoint、LWA 和错误分类。报告下载不携带授权头，仅允许受控 HTTPS S3 地址，拒绝重定向，压缩和解压均限 16 MiB。
- `processor.ts` 使用现有加密 checkpoint 持久化创建、轮询、下载。创建前保存意图；网络不确定时不盲目重发 createReport，需人工核对后重新审批。创建预算至少 100 秒，轮询至少 60 秒，报告最多等待 24 小时，遵守限流预算与退避。
- 报告身份、Marketplace、日期范围、粒度、数值、币种、重复和缺日均校验。缺失保留 NULL，缺日/缺指标/未闭合保存为 PARTIAL_SUCCESS 质量证据，不推进正式版本。完整写入和版本发布在事务中完成，失败保留当前有效数据。
- 销售查询按 source + businessDate 独立选最新成功版本，新小窗口不会隐藏旧日期。指定 taskId 可读历史版本。数据携带组织、工作区、Seller、Marketplace、任务/批次、报告/document、冻结范围、获取/发布时间及质量证据。
- 重试/恢复需新 control-task 审批，清除未发布暂存并保留此前计数/摘要审计。Worker 检查操作者、审批人、授权和源 revision；领取时失效转 BLOCKED，不请求 Amazon。

## 查询、导出与商品

`sales-query.ts` 使用范围约束和参数化 SQL，在数据库执行业务日期、Seller、Marketplace、任务、关键词、排序及分页。当前是店铺日粒度，拒绝 SKU/ASIN/Order ID 筛选；正式查询仅显示完整成功数据，异常在任务质量记录查看。`snapshot-query.ts` / `snapshots.ts` 支持库存/Listing 的 SKU、ASIN、关键词及明确时间字段筛选。

`exports.ts`、exports API 和既有 Worker 实现异步 JSONL 导出，冻结页面筛选及 asOf；manifest 和行数据携带来源/版本。上限 100,000 行、64 MiB，使用现有 Storage adapter/FileObject、lease/fence 和审计。申请、Worker、下载重复校验权限，文件仅限组织/工作区/申请人访问。

复用 operations:view/create/edit/approve/export 与 settings:edit，不另建 RBAC。授权验证底层服务同样要求匹配且已领取的审批。UI 提供日期申请、业务筛选、来源、质量、版本及导出；后端独立校验权限。

`amazon-field-policy.ts` 在商品 API 与 ProductRecord repository 边界剥离 amazonSnapshots/amazonSnapshotError。Amazon 观察数据独立保存，本轮没有同步写入 ProductRecord 的映射逻辑，不会刷新覆盖人工 ERP 字段。可配置的字段来源/优先级映射仍是后续工作。保留既有 ProductDetailService、revision CAS、事务、审计、Outbox 和草稿恢复，不切换列表读路径或增加缓存。

## 主要文件

- 新增 `src/lib/amazon-sync/{date-range,sales-traffic,sales-query,snapshot-query,exports}.ts`。
- 扩展 `src/lib/amazon-sync/{processor,service,policy,approval-policy,change-approval,scheduler,read,contracts,snapshots}.ts` 与 `src/lib/amazon/sp-api-client.ts`。
- API：`src/app/api/operations/sync-center/route.ts`、`exports/route.ts`；Worker：`scripts/amazon-sync-worker.ts`、`src/lib/queue/redis-queue.ts`。
- UI：`src/components/operations/{sales-traffic-workbench,sync-center-workbench}.tsx`。
- 商品：`src/lib/products/{amazon-field-policy,product-record-repository}.ts`、`src/app/api/products/route.ts`。
- Schema：`prisma/schema.prisma` 与 `20261104030000_amazon_sales_traffic_snapshots`，新增销售日快照/导出、范围 FK/唯一约束及 v2 约束扩展。迁移已在单独获批的临时空库验证，未应用到任何现有数据库。

## 验证与剩余门槛

- `npm run test`：698 项通过。新增日期/DST、质量、报告生命周期、权限撤销、创建不确定性、幂等和商品字段保护；无真实 HTTP/数据库。
- `npm run typecheck`：通过。
- `npm run lint -- --ignore-pattern '.next-amazon-live/**'`：0 error、5 项已有 warning。默认 check:fast 在测试通过后，被工作区已有未跟踪 `.next-amazon-live/` 生成代码阻断，不能记为全命令通过；没有修改全局 lint 配置。
- `npm run test:amazon-sync:browser`：16 项通过；`npm run test:products:browser`：16 项通过。两者为隔离模拟接口回归。
- Prisma validate/generate 在不可连接的 fixture DATABASE_URL 下通过；随后完成下述单独获批的临时 PostgreSQL 验证。
- `node scripts/test-amazon-sync-integration.mjs --sales-only`：四个 Amazon 增量迁移在临时空库事务中应用成功，旧任务计划保留且禁用；3 项真实 PostgreSQL 测试通过，覆盖逐日版本、部分失败保护、截止时间、筛选/分页、跨组织/工作区及唯一/FK 约束。结果见 [隔离验证记录](amazon-sync-sales-isolated-verification.json)。随后单独获批的 `--sales-pipeline` 综合用例也通过，验证正式审批服务、测试 BullMQ consumer、报告 processor、查询 API、本地 Storage/FileObject 及导出下载，见下节和 [完整链路记录](amazon-sync-sales-pipeline-verification.json)。两次临时容器和目录均已清理。旧默认 integration 测试仍需升级审批前置和队列名称；未运行生产构建、真实账号 E2E、性能 benchmark 或生产验收。
- 订单、财务、Ads、全数据域导出、可配置字段映射及真实接口验收仍未完成，不能宣称 ERP 已整体生产就绪。

已批准并执行的方案：`node scripts/test-amazon-sync-integration.mjs --sales-only`，只使用本机已安装的 postgres:16-alpine/redis:7 镜像，创建带随机后缀、仅回环随机端口的临时容器，PostgreSQL 512 MiB/1 CPU、Redis 128 MiB/0.5 CPU；固定空库 amazon_sync_test、fixture 密码，未读取真实凭证。以固定历史 schema 建空基线并执行 20261104000000/010000/020000/030000 四个迁移，再运行新增销售 SQL 测试。测试禁止外部 HTTP，不启动应用/生产 Worker，最终仅停止并删除本次临时容器和临时目录。脚本未拉镜像、未修改现有容器；该批准不延伸到任何现有环境迁移或真实联调。

真实联调方案必须列出 Organization/Workspace、Seller、Marketplace、目标环境、授权引用、已闭合短日期范围、报告类型、请求上限、数据保留、操作者和审批人；不记录密钥。用户针对方案明确批准后，才能验证真实授权、获取、重复同步、失败保护、后端筛选和导出。生产同步、凭证写入、推送、部署各须另外授权。

回退保留库存/Listing 路径，停用销售源及默认关闭的范围开关。已应用 schema 的回退需先确认代码/约束兼容，数据库采用向前修复，不执行自动 down migration。

## 完整销售链路集成补充（已获批执行并通过）

新增 `tests/integration/amazon-sales-pipeline.integration.ts`，使用两个独立 owner 身份经过正式申请/批准/应用服务，模拟授权验证，再从已登录 API 提交报告申请。真实 BullMQ Worker 调用现有 processor；仅 Amazon HTTP 被测试响应拦截，未匹配请求立即拒绝。覆盖业务日期真正传入 transport、报告发布与来源查询、幂等导出申请、临时本地 Storage/FileObject、按筛选/asOf 导出和下载内容一致、跨组织/工作区及非申请人拒绝、下载和执行前权限撤销、部分结果不覆盖、重试需新审批且保留冻结范围、旧队列投递不重建报告、已生成导出不随新发布变化，以及未创建 ProductRecord。

`scripts/test-amazon-sync-integration.mjs` 新增 `--sales-pipeline` 模式，强制测试子进程使用临时目录下的 local uploads、fixture session secret/database auth/local environment；不继承生产存储驱动。未知或组合模式在创建临时资源前拒绝，Docker 使用 `--pull=never`。TypeScript、定向 ESLint 与 runner 语法检查通过；仅测试/runner/交接文档变更，未重复运行无关构建或浏览器测试。

用户在具体方案提交后回复“继续”，已执行 `node scripts/test-amazon-sync-integration.mjs --sales-pipeline`，退出码 0，1 项综合集成用例通过（约 0.92 秒；测试进程约 1.30 秒）。容器、端口、资源限制、空基线和四个迁移与上述 sales-only 方案一致，新增 fixture 用户/会话/审批记录、真实测试 BullMQ consumer 和临时 JSONL 文件。通过 fixture 内修改 nextAttemptAt/API budget 跳过报告轮询等待，不更改正式执行器的限流逻辑。测试已关闭测试 Worker/Queue/Prisma，确认本次临时容器及包含 fixture 文件的临时目录已清理。没有真实 Amazon 请求、未读取真实凭证、未启动正式 worker 脚本或其他定时任务、未修改现有数据库/存储。

本结果证明该销售场景的隔离集成链路，不代表真实 Seller 授权有效、真实报告可用、官方服务实时行为/限流、生产 systemd Worker、R2/S3 或生产性能通过。无需因本次仅执行验证和更新记录重复跑全仓测试或构建；后续应用代码变化、准备合码/上线时再按仓库分级规则执行。

## 默认库存/Listing 集成入口修复（2026-11-05 已通过）

`tests/integration/amazon-sync-center.integration.ts` 已改为通过正式 requestChange/decideChange/applyChange 服务配置授权、验证站点、绑定数据源和申请/控制任务。不同 fixture 用户分别申请和审批，不绕过 approved-context。库存、Listing、分页恢复、租约 fencing、任务取消/暂停/重试、Redis 丢失后重新派发及授权轮换继续保留；断言改为当前实际契约：同源并发只允许一个活动任务、重复审批不能再次应用、计划配置不授予未来自动执行、失效执行前置转 BLOCKED、保留策略未获执行审批不能清理。队列 ID 改用现有 adc 前缀。

认证 API 场景直接检查申请返回 202，再经审批 API 由不同身份批准、由操作者应用，最后读取真实数据库/查询 API，不伪造成功 Response。Workspace 已有关联审批时外键应阻止删除；以配置 revision 改变验证冻结范围失效，避免在测试中假定可以删除受约束工作区。

`tests/integration/sync-center-browser.ts` 已接入真实审批 Route Handler。浏览器申请后，由独立 fixture 审批人经本机 HTTP 批准，再用申请人的 session 应用，刷新页面继续验证失败→重试→快照路径。仅 Amazon transport 模拟；浏览器只允许本次回环 origin。TypeScript 和定向 ESLint 通过。用户于 2026-11-05 明确批准后执行默认入口，16 项全部通过，0 失败，测试进程约 23.72 秒，无需修复重跑。默认集成的审批前置和队列 ID 适配已取得实际验证结果；此结果取代前文默认入口尚待适配的历史状态。

本次单独获批并执行命令：`node scripts/test-amazon-sync-integration.mjs`（无模式参数）。使用相同随机命名、回环端口、PostgreSQL 512 MiB/1 CPU 和 Redis 128 MiB/0.5 CPU 临时容器与四个迁移；运行库存/Listing 默认集成场景，并启动一个临时回环 HTTP 页面和 headless Chromium。包含 fixture 任务、会话、审批、队列清空（仅本次临时 Redis）、临时文件、浏览器和容量测试。未知 Amazon HTTP 请求和外部浏览器请求拒绝，未启动正式 Worker/定时任务、未修改真实配置/现有数据、未推送部署。测试结束关闭 browser/HTTP/测试 Worker/DB，确认临时目录已移除、fixture 容器剩余 0。

完整结果与容量原始样本见 [默认隔离集成记录](amazon-sync-default-isolated-verification.json)。1,000/5,000/10,000 行各采样 40 次 SQL 页读取，P95 约为 1.20/2.35/4.00 毫秒；这是资源受限的临时数据库 fixture 结果，未覆盖真实商品查询、浏览器并发、生产网络或生产 SLA，不能作为 Product Center 真实性能 benchmark。此次仅执行已写好的测试并更新记录，无应用代码变化，未机械重复全仓单测/构建。真实 Seller 授权、Amazon API 与生产验收仍未完成。

## 第一批生产安全补齐（2026-11-05，本地代码已实现）

用户已明确批准成员 Workspace/Seller 范围授权、任务执行期限、导出派发扫描分离、受控 Worker 及相关本地代码/迁移编写。实现与准入门槛统一见 [ERP 生产准入与实施清单](erp-production-readiness-plan.md)。普通成员须有既有 RBAC 与显式 Seller 授权；管理员申请和另一管理员批准后应用授权变更；原审批人降权后拒绝应用配置。任务 24 小时执行窗口过期/缺失转 BLOCKED，重试/恢复须新批准。旧无冻结范围导出需重新申请；新导出撤权后拒绝执行/下载，后续扩权不扩大原导出。

受控 Worker 使用 allowlist 哈希独立队列并禁用补货定时刷新，默认 standard 保持兼容；未启动任何真实 Worker。新增迁移 `20261105000000_amazon_data_access_grants` 仅编写，未执行；runner 已纳入第五迁移，先前四迁移执行批准及通过记录不能延伸用于本次。隔离 SQL 测试补充授权外键、唯一键及撤权查询拒绝。

本批核心测试 706 项通过、模拟 API 浏览器 17 项通过、类型检查通过；排除既有 `.next-amazon-live/**` 生成目录的 ESLint 0 errors/5 既有 warnings。未执行现有库迁移、真实 API、凭证写入、生产构建、推送或部署。新的五迁移隔离三模式方案已写入上述准入文档，待单独批准。

## 第五迁移及范围授权隔离验证（2026-11-05 已获批并通过）

用户单独批准后，依次执行 sales-only、sales-pipeline 和默认三个入口，均退出 0，分别 4/1/16 项通过，0 失败。每次使用新的随机临时 PostgreSQL/Redis 和空 fixture 库执行五迁移；授权外键/唯一键及撤权查询、销售审批/队列/版本/导出、库存/Listing 与浏览器恢复通过。无需代码修复或重跑，三个临时目录均已移除，测试标签容器剩余 0。

本结果更新前文“第五迁移待批准/待验证”的历史状态；旧四迁移结果保留。完整命令、测试名称、耗时与容量原始样本见 `docs/amazon-sync-access-grants-isolated-verification.json`；生产准入文档已同步。本次仅执行验证和更新文档，未重复单测/构建；Amazon HTTP 全部模拟，未读取真实凭证、修改现有数据库、启动正式 Worker、推送或部署。

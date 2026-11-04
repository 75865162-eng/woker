# ERP 生产准入与实施清单

更新：2026-11-05。本文区分代码实现、隔离验证、真实 Amazon 验收和生产发布。任何一层通过均不能替代下一层。

## 当前结论与配置时机

可以现在准备应用注册、Seller/Marketplace 清单、权限角色和私有凭证存放方案；尚不能据此启用生产同步。真实凭证写入和 API 请求分别需要针对具体环境、身份、范围和请求预算批准。当前第一批本地安全改动已通过第五迁移和三个模式的隔离数据库集成验证，可提交单 Seller / 单 Marketplace 的受控 API 配置及试运行方案。

投入生产的判断按证据门槛，不承诺日历日期。首批库存、Listing、销售日报可以独立验收和小范围启用；订单、财务和 Ads 未完成前，不对外承诺完整 Amazon 运营 ERP 已就绪。

## 已有能力与实际限制

| 模块 | 已有代码边界 | 尚需证据或开发 |
| --- | --- | --- |
| 库存 / Listing | SP-API transport、分页、暂存/校验/快照发布、任务来源查询 | 真实授权与站点资格、API 行为、重复同步和失败保护验收；快照不伪装支持历史业务日期拉取 |
| 销售流量 | Reports 创建/轮询/下载、Marketplace 时区日期、店铺逐日汇总、版本查询、异步 JSONL 导出 | 真实报告范围/权限/时区验收；不支持该汇总报告不存在的 SKU/ASIN/订单粒度 |
| 权限与审批 | 现有 operations/settings RBAC、双人审批、冻结范围、审计；本批增加成员 Seller 范围和执行截止时间 | 新迁移隔离集成、实际角色矩阵验收、运维撤权演练 |
| 商品主数据 | ProductRecord + revision/事务/审计/Outbox、ProductDetailService、独立编辑草稿、Amazon 观察字段写入保护 | 真实字段映射样本核对、导入/单条/批量冲突专项、1k/5k/10k 商品及并发 benchmark |
| 订单 | 未纳入本批已完成同步域 | 核验官方 API 版本/权限/受限数据资格、业务时间增量与回补、订单行/取消/退款和 PII 最小化 |
| 财务结算 | 未纳入本批已完成同步域 | 交易/结算账本、币种和费用口径、调整/退款/跨期对账及不可静默覆盖规则 |
| 广告 | PPC 导入分析工作流已有；不等于 Ads API 已验收 | 独立 Ads OAuth/Profile、报表异步流程、广告账户范围、归因窗口和延迟回补 |
| 采购/仓储/成本 | 不因 Amazon 快照存在而视为完成 | 按现有仓库另行审计采购入库、库存流水/预留、调拨、到岸成本与利润闭环；不在本批扩张商品核心域 |
| 运行保障 | 已有发布清单、Worker/心跳和回退边界 | 目标环境 HTTPS、备份恢复演练、告警到达、容量/磁盘与保留策略、队列积压及故障恢复证据 |

## 第一批：已批准的本地安全实施

- 新增 `AmazonDataAccessGrant`，复用 OrganizationMember、WorkspaceScope、SellerAccount 的复合外键、唯一键及索引。普通成员须同时具有现有 `operations:view` 和明确 Seller 授权；未授权拒绝。owner/database_admin 保留组织内管理入口，其他操作仍验证现有角色动作权限。
- 授权新增/撤销经过 `save-access-grant` 申请、另一管理员批准、应用、revision 和审计。应用时再次检查原审批人权限，角色撤销后不复用旧管理员批准。
- API、Service、业务查询、详情侧车数据、导出和 Worker 重新检查范围。导出冻结申请时 Seller 集合，后续扩权不扩大旧文件范围；撤权阻止执行和下载。
- 人工任务应用时冻结 24 小时执行窗口；请求审批有效期与执行期限独立。Scheduler 和 Worker 检查截止时间，失效为 BLOCKED，须通过新的重试/恢复审批续期。原范围和业务日期保留。没有授予未来定时任务无限执行权限。
- 导出分别扫描过期 RUNNING 和待派发 QUEUED，各有界 20 条，避免前 20 条运行任务遮住新任务；尚未证明跨组织公平调度或生产容量 SLA。
- `AMAZON_SYNC_WORKER_MODE=approved-only` 要求非空 JSON allowlist：`AMAZON_SYNC_WORKER_TASK_IDS`、`AMAZON_SYNC_WORKER_EXPORT_IDS`，分别最多 100 ID。只扫描/处理这些 ID，使用由集合哈希命名的独立队列，跳过补货刷新；未知模式和空清单拒绝启动。默认 standard 保留原行为。此处只交付代码，不启动真实 Worker。
- 受控队列的 Web enqueue 与 Worker 必须使用相同清单；由受控 Scheduler 恢复的允许任务可重新入专属队列。禁止将 standard Worker 与受控 Worker 的运行职责混作已经批准。现有同步设置心跳查询仅显示标准队列，受控队列须按精确 queueName 查验，不凭标准页面判断受控 Worker 在线。

主要实现文件：`prisma/schema.prisma`、`prisma/migrations/20261105000000_amazon_data_access_grants/migration.sql`、`src/lib/amazon-sync/{data-access,access-management,change-approval,service,execution-window,read,snapshots,sales-query,exports,processor,scheduler,worker-policy}.ts`、`src/lib/queue/redis-queue.ts`、`scripts/amazon-sync-worker.ts`、同步中心/导出及业务 API、`sync-center-workbench.tsx`。

兼容性：不自动给旧普通成员回填授权；旧无执行期限任务及旧无冻结授权信息导出拒绝继续使用，需新审批/申请。启用前须完成成员范围配置计划。回退先关闭同步中心，再回退经兼容性核验的匹配代码；保留新增表、历史数据和审计，不执行 down migration。

## 验证与下一步执行方案

本批当前验证：706 项核心测试通过；17 项模拟 API 浏览器测试通过；TypeScript 通过；ESLint 排除既有生成目录 `.next-amazon-live/**` 后 0 errors、5 项既有 warnings。Prisma schema validate/generate 已使用不可连接的 fixture URL 通过，未连接数据库。完整 `check:fast` 的原样命令未认定通过，因为默认 lint 会包含该既有生成目录。未运行生产构建、正式账号 E2E 或真实 API。

新增专项覆盖角色动作权限与 Seller 授权交集、失效/缺失执行期限、审批上下文、授权 revision/撤销、导出撤权、参数化 SQL、派发扫描和受控队列隔离。隔离 SQL 集成新增授权唯一键、成员/跨 Workspace 外键及授权撤销后查询拒绝场景，已在本次获批的三个临时空库执行通过，未对任何现有环境执行。

旧四迁移隔离结果见 phase2 文档和三个 verification JSON；它们是历史结果，不能用来证明当前第五迁移通过。

2026-11-05 用户单独批准后，已依次运行以下三条命令（模式不组合），每次创建并清理独立 fixture，全部退出 0：

```sh
node scripts/test-amazon-sync-integration.mjs --sales-only
node scripts/test-amazon-sync-integration.mjs --sales-pipeline
node scripts/test-amazon-sync-integration.mjs
```

仅使用已安装 `postgres:16-alpine`、`redis:7`（`--pull=never`）。随机容器名及回环随机端口；PostgreSQL 512 MiB/1 CPU，Redis 128 MiB/0.5 CPU。在空 `amazon_sync_test` fixture 库建立固定基线并执行五个增量迁移（原四个加 `20261105000000_amazon_data_access_grants`）。允许创建模拟身份、授权、审批、队列、导出文件；Amazon HTTP 全部模拟，未知请求拒绝；浏览器限本次回环 origin。只清空本次临时 Redis；最后关闭测试 browser/HTTP/consumer/连接并删除本次容器与临时目录。不读真实凭证，不连现有数据库、不启动正式 Worker/定时任务，不推送部署。可在同一边界内修复测试并重跑。三个模式顺序执行，资源上限不叠加。

## 后续门槛与完成定义

1. **本地安全代码门槛**：第五迁移及三个隔离场景通过；权限、撤权、审批过期、租约、幂等、查询与导出保持一致。当前已通过，详见下方结果。
2. **真实 API 配置门槛**：明确目标环境、Organization/Workspace、ERP Seller 与 Amazon Seller、Marketplace、区域/业务时区、所需官方权限、私有凭证引用、操作者/另一审批人。先提交凭证存放与写入方案；不在聊天或仓库保存密钥。既有独立本地联调环境文档只作检查线索，不自动批准修改。
3. **受控试运行门槛**：另行批准授权验证请求和单 Seller/单 Marketplace/单数据域的已闭合短日期范围；列明 API/Report、最大请求/轮询/下载/记录数、执行窗口、存储去向、保留与停止条件、允许 task/export ID。先授权验证，再试点快照或报告；不顺带开启所有计划。
4. **真实验收门槛**：记录实际请求 ID/Report ID、日期输入/实际范围、版本与发布时间；验证重复拉取无重复、失败不替换有效版本、筛选/分页/导出一致、跨组织/Workspace 和不足权限拒绝、商品人工字段不覆盖。报表合法无数据单独记录，不能填零或冒充有业务样本验收。
5. **首批生产门槛**：完整改动区盘点，识别既有无关改动；合码前完整 check/diff 检查；迁移人工审核、目标备份与恢复证据、HTTPS、监控/错误告警/资源阈值、授权与数据保留策略、明确回退版本。GitHub 推送、现有库迁移、CI 发布、生产任务分别提交方案获批。按 CI artifact 发布，不临时改服务器构建。
6. **扩大业务门槛**：先稳定首批数据域，再分别实施订单、财务、Ads 和仓储成本模块。每域明确官方接口版本、权限、Marketplace、粒度/业务时间、历史窗口、频率/配额、质量及增量回补策略；提供独立验收证据后开放。业务扩张不绕过商品主数据性能与架构收口约束。

上线验收由实际证据关卡决定；当前可以推进到受控配置的准备阶段，尚未具备生产投入使用结论。

## 第五迁移隔离验收结果（2026-11-05）

三个入口均一次通过，无需修复重跑：销售 SQL/授权约束 4 项（测试进程约 0.38 秒）、销售完整链路 1 项（约 1.59 秒）、默认库存/Listing/浏览器 16 项（约 23.96 秒）。每个入口均在独立空 fixture 库执行五个迁移，保留且停用旧计划。新授权成员外键、跨 Workspace Seller 外键、唯一键以及授权撤销后 SQL 拒绝访问已取得真实 PostgreSQL 验证。

确认三个临时目录均已移除，带本测试标签的容器剩余 0。未改变应用代码；沿用上批 706 核心测试、17 模拟 API 浏览器、类型与 lint 结果，不机械重复全仓检查。原四迁移验证 JSON 保留为历史记录，本次独立记录见 [第五迁移隔离结果](amazon-sync-access-grants-isolated-verification.json)。容量数据仍仅为 fixture SQL，不是商品或生产 SLA。

下一步是准备真实配置与最小试运行方案，须填实目标范围、凭证存放引用、操作者和审批人后另行批准；本次批准不包含真实 API、现有库迁移、配置写入或部署。

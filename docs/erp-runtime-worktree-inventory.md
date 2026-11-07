# 当前未提交改动清单与本轮收口

## 盘点口径

本轮清理前的快照：92 个已跟踪文件改动，106 个未跟踪文件。
此前 83 是 Git 默认把未跟踪目录合并后的条目数，不是文件数。下表为本轮新增改动前的快照；它不能证明文件无用，也不能代表已经提交或已在 GitHub 同步。

| 范围 | 已跟踪改动 | 未跟踪文件 | 内容 |
| --- | ---: | ---: | --- |
| 根目录 | 8 | 0 | 环境模板、ignore、AGENTS、依赖、构建配置 |
| deploy | 5 | 2 | web/worker systemd、备份 service/timer |
| prisma | 1 | 4 | schema 与四项迁移 |
| scripts | 10 | 20 | Worker 管理、配置、备份、同步预检与隔离测试 |
| src | 45 | 34 | Amazon、Sellfox、运行状态、队列、导出及页面 |
| tests | 19 | 20 | 对应业务、权限、故障恢复与浏览器测试 |
| docs | 5 | 23 | 方案、验收、运行记录与 patch 草案 |
| specs | 0 | 3 | ERP 运行收口规格、计划、任务 |

这些文件全部保留。不能从 Git 状态确认具体由哪个聊天或人员修改，也不能仅据文件名认定已完成验收。

## 本轮完成

- 用户批准清理构建目录后，确认 `.next-build` 没有打开文件、没有受 Git 跟踪文件且不是符号链接，删除该目录（含 standalone）；清理前约 1.5 GB。
- `.next-dev` 正被 3017 开发网页使用，保留约 943 MB。没有停止网页或 Worker。
- `environment.mjs` 增加 database/schema 验证模式，复用根配置解析、继承冲突检查、生产注入边界和本地 loopback 检查。数据库工具不要求 Redis；schema 模式允许无数据库配置，不打开连接。
- `database-bootstrap.mjs` 在维护脚本导入前加载。package 中原先使用 `--env-file=.env` 的 11 项命令改为统一 preload，脚本原有 apply/角色/范围限制不变。两个工具 README 同步示例。
- `prisma.config.ts` 移除 dotenv；generate/validate/format 允许无数据库，其他子命令要求数据库配置。没有执行 generate、迁移或维护任务。
- benchmark 移除独立 dotenv，但保留已有 `PRODUCT_BENCHMARK_DATABASE_URL` 专用测试库语义，不把会写数据的性能测试改到主数据库。实际 benchmark 未执行；专用目标的额外身份检查需后续审阅。

## 配置归档的待执行范围

`.env.amazon-live.local` 未移动或删除，根 `.env` 未写入。已发现 `tmp/amazon-live-private/runtime.mjs`、`setup.mjs` 仍有旧路径引用，不能把它视为完全无引用垃圾。统一加载器拒绝把它作为 DOTENV_CONFIG_PATH；它仅存在于目录中不会被当前 loader 自动加载，先前“文件存在即被拒绝”的表述不准确。

建议正式归档清单：在仓库外 `~/.codex/backups/erp-config-archive/<UTC timestamp>/` 保存旧文件和变量名/相等性清单；目录0700、配置0600，SHA256复核后移出根目录；不复制或覆盖根 `.env`，不上传归档。执行前重新确认根配置覆盖所需变量、旧启动入口不再生效、没有进程打开旧配置。旧 tmp 启动器的退役与删除须逐文件列出；历史日志、数据库 dump、恢复库不纳入删除。此清单尚未执行。

## 验证与限制

本轮定向测试覆盖 runtime、CLI、配置和真实 Prisma schema validate；fixture 使用显式临时数据或无凭据的进程环境，不继承根配置。类型与定向 lint 另执行。完整生产构建留到批准全工作区合码/发布时；没有服务器、供应商请求、故障注入或真实配置归档执行结果。

回滚只撤回本轮精确源文件差异，保留既有未提交内容。已删除构建产物需要重新 build，活跃 dev 无需重启。未 commit/push。

## 清理前逐文件状态

` M` 表示已跟踪文件有修改，`??` 表示新增但未纳入 Git。以下清单不包含本轮新增的 inventory、database bootstrap、工具测试及其他后续差异。

```text
 M .env.example
 M .gitignore
 M AGENTS.md
 M deploy/systemd/amazon-image-upscale-worker.service
 M deploy/systemd/amazon-sellfox-sync-worker.service
 M deploy/systemd/amazon-sync-worker.service
 M deploy/systemd/amazon-web.service
 M deploy/systemd/amazon-worker.service
 M docs/amazon-auto-sync-live-acceptance-2026-11-06.md
 M docs/amazon-sync-center-phase1/quick-delivery.md
 M docs/sellfox-orders-shipments-restock.md
 M docs/sellfox-replica/design.md
 M docs/sellfox-sync-workbench-plan.md
 M eslint.config.mjs
 M next.config.ts
 M package-lock.json
 M package.json
 M prisma/schema.prisma
 M scripts/amazon-sync-live-preflight.mjs
 M scripts/amazon-sync-worker.ts
 M scripts/deployment-plan.mjs
 M scripts/image-upscale-worker.ts
 M scripts/import-worker.ts
 M scripts/next-run.mjs
 M scripts/ops-cli.ts
 M scripts/sellfox-sales-backfill.ts
 M scripts/sellfox-sync-worker.ts
 M scripts/test-amazon-sync-integration.mjs
 M src/app/api/files/upload/route.ts
 M src/app/api/image-upscale/route.ts
 M src/app/api/operations/sync-center/route.ts
 M src/app/api/sellfox/overview/route.ts
 M src/app/api/sellfox/schedules/route.ts
 M src/app/api/sellfox/sync/route.ts
 M src/app/api/system/worker-health/route.ts
 M src/app/globals.css
 M src/app/operations/page.tsx
 M src/app/sellfox/orders/page.tsx
 M src/app/sellfox/restock/page.tsx
 M src/app/sellfox/shipments/page.tsx
 M src/app/settings/page.tsx
 M src/components/operations/domain-reports-workbench.tsx
 M src/components/operations/sync-center-workbench.tsx
 M src/components/sellfox/domain-tabs.tsx
 M src/components/sellfox/sellfox-workbench.tsx
 M src/components/settings/sellfox-health-panel.tsx
 M src/components/settings/settings-tabs.tsx
 M src/components/settings/worker-health-panel.tsx
 M src/lib/amazon-ads/report-dispatch.ts
 M src/lib/amazon-sync/approval-policy.ts
 M src/lib/amazon-sync/automatic-connection.ts
 M src/lib/amazon-sync/automatic-schedule.ts
 M src/lib/amazon-sync/change-approval.ts
 M src/lib/amazon-sync/domain-reports-query.ts
 M src/lib/amazon-sync/domain-reports.ts
 M src/lib/amazon-sync/finance.ts
 M src/lib/amazon-sync/lineage-audit.ts
 M src/lib/amazon-sync/observation-machine.ts
 M src/lib/amazon-sync/observation-policy.ts
 M src/lib/amazon-sync/processor.ts
 M src/lib/amazon-sync/returns.ts
 M src/lib/amazon-sync/scheduler.ts
 M src/lib/amazon-sync/service.ts
 M src/lib/amazon/sp-api-client.ts
 M src/lib/audit/versioning.ts
 M src/lib/excel/bulk-export.ts
 M src/lib/image-upscale/processor.ts
 M src/lib/jobs/processor.ts
 M src/lib/queue/index.ts
 M src/lib/queue/redis-queue.ts
 M src/lib/sellfox/client.ts
 M src/lib/sellfox/restock-read.ts
 M src/lib/sellfox/sync-service.ts
 M tests/amazon-ads-reporting-v1-transport.test.ts
 M tests/amazon-automatic-schedule.test.ts
 M tests/amazon-domain-reports.test.ts
 M tests/amazon-returns.test.ts
 M tests/amazon-sales-traffic.test.ts
 M tests/amazon-sp-api-client.test.ts
 M tests/amazon-sync-center.test.ts
 M tests/amazon-sync-preflight.test.mjs
 M tests/browser/sync-center.spec.ts
 M tests/deployment-plan.test.ts
 M tests/integration/amazon-ads.integration.ts
 M tests/integration/amazon-domain-reports.integration.ts
 M tests/integration/amazon-finance.integration.ts
 M tests/integration/amazon-observations.integration.ts
 M tests/integration/amazon-sync-lifecycle.integration.ts
 M tests/ops-cli.test.ts
 M tests/release-runtime.test.ts
 M tests/sellfox-replica-read-api.test.ts
 M tests/sellfox-restock.test.ts
?? deploy/backup/amazon-postgres-backup.service
?? deploy/backup/amazon-postgres-backup.timer
?? docs/amazon-four-domain-repair-delivery-2026-11-06.md
?? docs/amazon-four-domain-repair-proposal-2026-11-06.md
?? docs/amazon-live-full-sync-execution-2026-11-06.md
?? docs/amazon-product-detail-configuration-proposal-2026-11-06.md
?? docs/amazon-seller-archive-delivery-2026-11-06.md
?? docs/amazon-server-auto-sync-acceptance-plan-2026-11-06.md
?? docs/amazon-settlement-storage-draft.sql
?? docs/amazon-settlement-storage-review-2026-11-06.md
?? docs/erp-runtime-bulk-export-repair-approval.md
?? docs/erp-runtime-current-review-and-approval.md
?? docs/erp-runtime-hardening-2026-11-06.md
?? docs/erp-runtime-local-closure-validation.md
?? docs/erp-runtime-local-config-cutover-approval.md
?? docs/erp-runtime-local-cutover-execution-approval.md
?? docs/erp-runtime-operations.md
?? docs/erp-runtime-plan-a-cli-and-ai-draft.md
?? docs/erp-runtime-plan-a-delivery.md
?? docs/erp-runtime-recovery-follow-up-approval.md
?? docs/erp-runtime-unification-proposal-2026-11-06.md
?? docs/erp-runtime-upgrade-delivery-2026-11-06.md
?? docs/operations-eight-sections.md
?? docs/patches/bulk-export-node-xml-proposal.patch
?? docs/sellfox-credentials-form-proposal.md
?? prisma/migrations/20261106060000_amazon_audited_local_recovery/migration.sql
?? prisma/migrations/20261106070000_amazon_settlement_attribution/migration.sql
?? prisma/migrations/20261106150000_sellfox_integration_credentials/migration.sql
?? prisma/migrations/20261106170000_runtime_execution_leases/migration.sql
?? scripts/collect-amazon-product-details.ts
?? scripts/configure-amazon-product-details.ts
?? scripts/preflight-amazon-four-domains.ts
?? scripts/preflight-amazon-identity-recovery.ts
?? scripts/preflight-amazon-product-details.ts
?? scripts/probe-amazon-product-details.ts
?? scripts/runtime/backup-postgres.mjs
?? scripts/runtime/cutover-backup.mjs
?? scripts/runtime/environment.mjs
?? scripts/runtime/generated-types-cleanup.mjs
?? scripts/runtime/local-cutover-preflight.mjs
?? scripts/runtime/parent-lifecycle.mjs
?? scripts/runtime/start-standalone.mjs
?? scripts/runtime/typecheck.mjs
?? scripts/runtime/version.mjs
?? scripts/runtime/worker-bootstrap.mjs
?? scripts/runtime/worker-child.mjs
?? scripts/runtime/worker-manager.mjs
?? scripts/test-runtime-integration.mjs
?? scripts/test-sellfox-credentials-integration.mjs
?? specs/008-erp-runtime-closure/plan.md
?? specs/008-erp-runtime-closure/spec.md
?? specs/008-erp-runtime-closure/tasks.md
?? src/app/api/integrations/sellfox/credentials/route.ts
?? src/app/api/integrations/sellfox/credentials/test/route.ts
?? src/components/operations/operations-sections.tsx
?? src/components/operations/seller-report-evidence-panel.tsx
?? src/components/settings/sellfox-credentials-form.tsx
?? src/components/settings/sellfox-credentials-panel.tsx
?? src/lib/amazon-sync/finance-recovery.ts
?? src/lib/amazon-sync/identity-adoption.ts
?? src/lib/amazon-sync/identity-recovery.ts
?? src/lib/amazon-sync/product-access-evidence.ts
?? src/lib/amazon-sync/product-discovery.ts
?? src/lib/amazon-sync/report-attribution-recovery.ts
?? src/lib/amazon-sync/report-recovery.ts
?? src/lib/amazon-sync/report-row-attribution.ts
?? src/lib/amazon-sync/seller-archive-policy.ts
?? src/lib/amazon-sync/seller-report-evidence.ts
?? src/lib/amazon-sync/settlement-download-parts.ts
?? src/lib/amazon-sync/settlement-scope.ts
?? src/lib/amazon-sync/settlements.ts
?? src/lib/amazon/report-download-range.ts
?? src/lib/excel/bulk-workbook-xml.ts
?? src/lib/runtime/connection-identity.ts
?? src/lib/runtime/dispatch-persisted-job.ts
?? src/lib/runtime/heartbeat-writer.ts
?? src/lib/runtime/job-execution.ts
?? src/lib/runtime/queue-health.ts
?? src/lib/runtime/queued-recovery.ts
?? src/lib/runtime/worker-diagnostics.ts
?? src/lib/runtime/worker-health.ts
?? src/lib/runtime/worker-registry.json
?? src/lib/sellfox/connection-test.ts
?? src/lib/sellfox/credential-context.ts
?? src/lib/sellfox/credential-crypto.ts
?? src/lib/sellfox/credential-store.ts
?? tests/amazon-four-domain-boundaries.test.ts
?? tests/amazon-isolated-runtime.test.ts
?? tests/amazon-product-discovery.test.ts
?? tests/amazon-report-download-range.test.ts
?? tests/amazon-report-recovery.test.ts
?? tests/amazon-report-row-attribution.test.ts
?? tests/amazon-seller-archive-policy.test.ts
?? tests/amazon-seller-report-evidence.test.ts
?? tests/amazon-settlements.test.ts
?? tests/browser/sellfox-credentials-harness.tsx
?? tests/browser/sellfox-credentials.config.ts
?? tests/browser/sellfox-credentials.spec.ts
?? tests/bulk-export-node.test.ts
?? tests/integration/runtime-execution-child.ts
?? tests/integration/runtime-execution.integration.ts
?? tests/integration/runtime-faults.integration.ts
?? tests/integration/sellfox-credentials.integration.ts
?? tests/runtime-unification.test.ts
?? tests/sellfox-connection-test.test.ts
?? tests/sellfox-credentials.test.ts
```

## 旧配置归档完成（本次用户明确要求修复后归档）

以上“未归档”为此前快照，由本节更新。执行完成时间 UTC：2026-11-06T18:04:45.329Z。

- 旧配置 21 个变量中 19 个与根配置一致；另外两个为退役 DOTENV_CONFIG_PATH 与旧启动 NODE_ENV，不新增第二配置来源。根 .env SHA256 前后相等，没有写入根配置。
- tmp/amazon-live-private/runtime.mjs 保留 config/isolatedEnvironment 导出，复用统一 runtimeEnvironment；取消隐式变量清空、旧 profile 与私自增加的运行参数。直接 start 拒绝执行。
- setup.mjs、reload-approved-worker.mjs、restart-repaired-web.mjs 改为明确拒绝的退役入口，不再创建配置/容器、停进程或启动第二套网页/Worker。它们属于 Git 忽略的本机历史脚本，不是已提交仓库源码。
- 原脚本四份、原配置与变量名比较清单已归档至 /Users/chenjieliang/.codex/backups/erp-config-archive/2026-11-06T18-04-45-252Z，目录0700/文件0600；原配置 SHA256 复核通过后才移出项目根目录。归档不提交、不上传。
- 4个退役启动入口无凭据进程验证通过；历史配置导出在显式 fixture 环境验证通过；归档校验、权限与根配置未变验证通过。四脚本语法检查通过。没有运行浏览器业务、供应商请求、数据库操作、进程停止或重启。
- 只读盘点脚本仍可保留旧文件可选分支；cutover-backup.mjs 是有原始 SHA 前置条件的一次性历史工具，没有执行或改成读取归档。历史文档与测试中的旧文件名不属于活跃配置加载入口。
- 回滚需审阅后从受限归档恢复对应脚本/配置，不能把归档当作可执行启动器；正常运行继续使用根.env 与 npm run dev / npm run worker。

## 本轮无用旧入口和重复文档清理

用户明确要求删除不用的旧入口、文档。本次删除下列6个文件；此前清单和归档记录保留为历史快照，不能作为当前文件仍存在的证据。

- `tmp/amazon-live-private/setup.mjs`
- `tmp/amazon-live-private/reload-approved-worker.mjs`
- `tmp/amazon-live-private/restart-repaired-web.mjs`
- `docs/erp-runtime-unification-proposal-2026-11-06.md`
- `docs/erp-runtime-bulk-export-repair-approval.md`
- `docs/patches/bulk-export-node-xml-proposal.patch`

三个旧启动文件均为已退役拒绝入口，未找到调用方；两份审批文档已被现有交付记录替代。Bulk patch 的源码与测试反向check通过，saxes依赖在package及lock均存在；完整patch反向check因lock上下文变化失败，未执行任何补丁应用或回退。

保留 runtime.mjs：仍有5个历史检查/修复脚本导入统一配置接口。保留运行说明、迁移审批、故障恢复与生产未完成项。6个文件删除前逐个留存校验副本于本机 /Users/chenjieliang/.codex/backups/erp-config-archive/2026-11-06T18-04-45-252Z/removed-obsolete-20261106T180818926900Z；不上传。

验证：删除范围与校验和复核、调用方检索；本轮没有业务代码改动，不重跑业务测试或构建。未删除真实配置、任务、日志、数据、备份，不停止服务，不commit/push。

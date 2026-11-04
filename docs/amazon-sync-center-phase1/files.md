# 变更文件清单

记录整体同步范围；用户在范围说明后确认继续，全部纳入当前分支提交／推送。Phase 0 文档已先完成，不是业务实现代码。

## Phase 1 修改既有文件

- `tests/market-agent.test.ts`（收尾验证：匹配工作区当前真实数据源阻断行为；与既有 market.ts 修改有关联）
- `AGENTS.md`
- `package.json`
- `prisma/schema.prisma`
- `scripts/amazon-sync-worker.ts`
- `src/app/api/integrations/amazon/sp-api/bindings/route.ts`
- `src/app/api/integrations/amazon/sp-api/credentials/route.ts`
- `src/app/api/operations/inventory/snapshots/route.ts`
- `src/app/api/operations/products/route.ts`
- `src/app/api/operations/schedules/route.ts`
- `src/app/api/operations/sync-runs/route.ts`
- `src/app/operations/page.tsx`
- `src/lib/amazon/integration-secrets.ts`
- `src/lib/amazon/sp-api-client.ts`
- `src/lib/operations/amazon-products.ts`
- `src/lib/operations/readiness.ts`
- `src/lib/operations/schedules.ts`
- `src/lib/operations/sync-processor.ts`
- `src/lib/queue/redis-queue.ts`

## Phase 1 新增文件

- `docs/amazon-sync-center-phase1/verification-summary.json`
- `docs/amazon-sync-center-phase1/files.md`
- `docs/amazon-sync-center-phase1/validation.md`
- `docs/amazon-sync-center-phase1/README.md`
- `docs/amazon-sync-center-phase1/capacity-fixture.json`
- `docs/amazon-sync-center-phase1/implementation.md`
- `docs/amazon-sync-center-phase1/rollout.md`
- `prisma/migrations/20261104000000_amazon_sync_center_phase1/migration.sql`
- `scripts/test-amazon-sync-integration.mjs`
- `src/app/api/operations/sync-center/route.ts`
- `src/components/operations/sync-center-workbench.tsx`
- `src/lib/amazon-sync/checkpoint.ts`
- `src/lib/amazon-sync/compatibility.ts`
- `src/lib/amazon-sync/contracts.ts`
- `src/lib/amazon-sync/maintenance.ts`
- `src/lib/amazon-sync/policy.ts`
- `src/lib/amazon-sync/processor.ts`
- `src/lib/amazon-sync/read.ts`
- `src/lib/amazon-sync/scheduler.ts`
- `src/lib/amazon-sync/service.ts`
- `tests/amazon-sync-center-api.test.ts`
- `tests/amazon-sync-center.test.ts`
- `tests/browser/sync-center-harness.tsx`
- `tests/browser/sync-center.config.ts`
- `tests/browser/sync-center.spec.ts`
- `tests/integration/amazon-sync-center.integration.ts`

## Phase 0 新增文件

- `docs/amazon-sync-center-phase0/README.md`
- `docs/amazon-sync-center-phase0/api-domain-matrix.md`
- `docs/amazon-sync-center-phase0/architecture.md`
- `docs/amazon-sync-center-phase0/audit.md`
- `docs/amazon-sync-center-phase0/delivery-plan.md`
- `docs/amazon-sync-center-phase0/official-live-doc-evidence.json`
- `docs/amazon-sync-center-phase0/official-model-evidence.json`
- `docs/amazon-sync-center-phase0/prototype-overview.png`
- `docs/amazon-sync-center-phase0/prototype.html`
- `docs/amazon-sync-center-phase0/ui-design.md`

## 早于本任务的改动（保留原内容，本轮一并同步）

- `deploy/caddy/Caddyfile`
- `docs/lili-local-routing.md`
- `middleware.ts`
- `next.config.ts`
- `src/app/api/integrations/sellersprite/route.ts`
- `src/components/agents/agent-center-workbench.tsx`
- `src/components/agents/agent-detail-workbench.tsx`
- `src/components/settings/amazon-sp-api-settings-panel.tsx`
- `src/components/settings/settings-workbench.tsx`
- `src/lib/agent-platform/market.ts`
- `src/lib/integrations/sellersprite.ts`
- `tests/browser/amazon-sp-api-settings.spec.ts`

用户已确认继续整体同步；本轮没有执行 git stash、重置或遗漏工作区改动的局部提交。部署文件改动属于既有内容，不代表本轮执行或授权发布。已有分支相对 main 的已提交历史也会体现在 PR #3，保留原有商品与品牌相关修改。

## 快速交付本地增量（未提交／未推送）

- `docs/amazon-sync-center-phase1/README.md`
- `docs/amazon-sync-center-phase1/files.md`
- `docs/amazon-sync-center-phase1/quick-delivery.md`
- `docs/amazon-sync-center-phase1/verification-summary.json`
- `prisma/migrations/20261104010000_amazon_authorization_validation_state/migration.sql`
- `prisma/schema.prisma`
- `scripts/test-amazon-sync-integration.mjs`
- `src/app/api/operations/sync-center/route.ts`
- `src/components/operations/sync-center-workbench.tsx`
- `src/lib/amazon-sync/contracts.ts`
- `src/lib/amazon-sync/processor.ts`
- `src/lib/amazon-sync/service.ts`
- `src/lib/amazon-sync/snapshots.ts`
- `tests/browser/sync-center.spec.ts`
- `tests/integration/amazon-sync-center.integration.ts`

- `tests/integration/sync-center-browser.ts`（真实浏览器到数据库／队列／Worker 的完整回归，仅模拟 Amazon）

- `docs/amazon-sync-center-phase1/ui-overview.png`（按用户参考图调整后的实际组件截图，测试数据）

- `docs/amazon-sync-center-phase1/ui-plans.png`
- `docs/amazon-sync-center-phase1/ui-tasks.png`
- `docs/amazon-sync-center-phase1/ui-connections.png`（以上均为真实组件＋测试数据视觉验证）

- `docs/amazon-sync-center-phase1/ui-quality.png`
- `docs/amazon-sync-center-phase1/ui-task-detail.png`（实际组件＋测试数据）

## 真实联调准备增量（本地，未提交）

- `src/lib/amazon/sp-api-client.ts`、`src/lib/amazon-sync/service.ts`、`src/lib/amazon-sync/processor.ts`：LWA 授权错误识别、短有效期 Token 缓存、Listings 末页数量验证。
- `scripts/amazon-sync-live-preflight.mjs`、`tests/amazon-sync-preflight.test.mjs`：仅检查配置的安全预检及专项测试。
- `tests/amazon-sp-api-client.test.ts`、`tests/amazon-sync-center.test.ts`、`tests/integration/amazon-sync-center.integration.ts`：刷新、错误落库及阻断、截断保护测试。
- `docs/amazon-sync-center-phase1/live-validation.md`、`live-preflight-result.json`；同步更新 README、rollout、verification-summary、files 及 AGENTS.md。无本阶段新增迁移或 API 参数变化。

## 专用本地环境配置（未提交）

- 文档：`local-environment.md`、`local-environment-result.json`，README／live-validation／verification-summary／files／AGENTS 同步。
- 私有运行文件：git 忽略的 `.env.amazon-live.local`、`tmp/amazon-live-private/`；仅本地持有，不提交、不打印。
- 独立容器／volumes 与本地进程见 local-environment.md；无业务代码、新迁移、API 或 ProductRecord 变更。

## 全新页面合并增量

- `src/components/operations/sync-center-workbench.tsx`：统一业务导航，移除旧页回退与旧凭证导入，view 历史恢复，新任务入口。
- `src/components/operations/operations-hub-workbench.tsx`：业务面板内嵌与按需读取，库存操作交给新同步中心。
- `tests/browser/sync-center.spec.ts`：合并导航、请求范围、新队列入口、禁用时不回退测试。
- `merged-business-result.json`、`ui-merged-business.png` 及 quick-delivery／local-environment／rollout／verification-summary／files／README：当前新库行为与验证记录。

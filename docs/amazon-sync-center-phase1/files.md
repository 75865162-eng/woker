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

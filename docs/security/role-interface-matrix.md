# 角色 × 接口权限矩阵（自动生成）

> 生成时间：2026-11-24T12:38:57.319Z
> 共 251 个 API 路由，250 个受接口级/领域鉴权保护，1 个公开或自带鉴权入口；225 个带工作区围栏。

## 鉴权方式分布

| 鉴权方式 | 路由数 |
|---|---:|
| `apiPermission` | 193 |
| `sessionUser` | 57 |
| `authEndpoint` | 33 |
| `amazonRead` | 29 |
| `wmsAccess` | 14 |
| `pointsAccess` | 10 |
| `mcpBearer` | 9 |
| `publicHealth` | 8 |
| `accessEdit` | 7 |
| `accessView` | 7 |
| `liliOAuth` | 4 |
| `researchAccess` | 4 |
| `workspacesAccess` | 2 |

## 公开 / 自带鉴权入口（需人工确认）

该类入口不走统一的 requireApiPermission，但多数由会话用户、领域鉴权或 Bearer 凭证保护；下表列出静态识别到的鉴权线索，便于逐条复核。

| 路由 | 方法 | 鉴权线索 |
|---|---|---|
| `/health` | GET | 无（公开端点，如健康检查） |

## 全量接口明细

| 路由 | 方法 | 鉴权方式 | 模块 | 动作 | 工作区围栏 |
|---|---|---|---|---|---|
| `/accounts/access/effective` | GET | accessEdit, accessView, apiPermission | accounts | view,edit | ✓ |
| `/accounts/access/matrix` | GET | accessEdit, accessView, apiPermission, authEndpoint, sessionUser | accounts | view,edit | ✓ |
| `/accounts/access/preview` | POST | accessEdit, accessView, apiPermission, authEndpoint, sessionUser | accounts | view,edit | ✓ |
| `/accounts/access` | GET,PUT | accessEdit, accessView, apiPermission, authEndpoint, sessionUser | accounts | view,edit | ✓ |
| `/accounts/approvals` | GET,PUT | accessEdit, accessView, apiPermission, authEndpoint, sessionUser | accounts | view,edit | ✓ |
| `/accounts/mcp/scopes` | GET,PUT | accessEdit, accessView, apiPermission, authEndpoint, sessionUser | accounts | view,edit | ✓ |
| `/accounts/points/templates` | GET,PUT | accessEdit, accessView, apiPermission | accounts | view,edit | ✓ |
| `/accounts/role-permissions` | GET,PUT | apiPermission | accounts | view,edit | ✓ |
| `/accounts/roles` | GET,PUT | apiPermission | accounts | view,edit | ✓ |
| `/accounts/team-members` | GET,PUT | apiPermission, authEndpoint | accounts | view,edit | ✓ |
| `/agents/[agentId]/executions` | POST | apiPermission | agents | create | ✓ |
| `/agents/[agentId]` | GET | apiPermission | agents | view | ✓ |
| `/agents/approvals/[approvalId]` | POST | apiPermission | agents | approve | ✓ |
| `/agents/evaluations` | GET | apiPermission | agents | view | ✓ |
| `/agents/listing/executions` | POST | apiPermission | agents | create | ✓ |
| `/agents/listing/projects` | POST | apiPermission | agents | create | ✓ |
| `/agents/listing` | GET | apiPermission | agents | view | ✓ |
| `/agents/market/executions` | POST | apiPermission | agents | create | ✓ |
| `/agents/market/projects` | POST | apiPermission | agents | create | ✓ |
| `/agents/market/selection-evidence` | POST | apiPermission | agents | create | ✓ |
| `/agents/market/selection-local` | GET,POST | apiPermission | agents,products | — | ✓ |
| `/agents/market/selection-reviews` | POST | apiPermission | agents,products | — | ✓ |
| `/agents/market/selection-slugs` | GET | apiPermission | agents,products | — | ✓ |
| `/agents/market/selection-suppliers` | POST | apiPermission | agents,products | — | ✓ |
| `/agents/orchestrator/executions` | POST | apiPermission | agents | create | ✓ |
| `/agents/orchestrator` | GET | apiPermission | agents | view | ✓ |
| `/agents/ppc/actions` | POST | apiPermission | agents | create | ✓ |
| `/agents/ppc/audits/[auditId]/apply` | POST | apiPermission | agents | approve | ✓ |
| `/agents/ppc/audits/[auditId]` | GET | apiPermission | agents | view | ✓ |
| `/agents/ppc/audits` | GET | apiPermission | agents | view | ✓ |
| `/agents/ppc/executions` | POST | apiPermission | agents | create | ✓ |
| `/agents/product/executions` | POST | apiPermission | agents | create | ✓ |
| `/agents/product/projects` | POST | apiPermission | agents | create | ✓ |
| `/agents` | GET | apiPermission | agents | view | ✓ |
| `/agents/supplier/projects` | POST | apiPermission | agents | create | ✓ |
| `/agents/tools` | GET | apiPermission | agents | view | ✓ |
| `/ai-settings` | GET,PUT | apiPermission, authEndpoint | settings | view,edit | ✓ |
| `/ai-settings/test-chat` | POST | apiPermission | settings | view | ✓ |
| `/ai/chat/conversations/[id]/messages` | POST | apiPermission, authEndpoint, sessionUser | agents | create | ✓ |
| `/ai/chat/conversations/[id]` | GET,PATCH,DELETE | apiPermission | agents | view,create | ✓ |
| `/ai/chat/conversations/[id]/runs/[runId]/cancel` | POST | apiPermission | agents | create | ✓ |
| `/ai/chat/conversations/[id]/runs/[runId]` | GET | apiPermission | agents | view | ✓ |
| `/ai/chat/conversations` | GET,POST | apiPermission | agents | view,create | ✓ |
| `/ai/chat/data-sources` | GET,PUT | apiPermission | agents | view,create | ✓ |
| `/amazon/catalog-workbench/items` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/amazon/catalog-workbench` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/amazon/inventory-workbench/asins` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/amazon/inventory-workbench` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/amazon/main-images` | POST | amazonRead, sessionUser | — | — | ✓ |
| `/approvals/center` | GET | apiPermission | operations | view | ✓ |
| `/assets/[...key]` | GET | apiPermission | — | — | ✓ |
| `/assets/upload` | POST | apiPermission | listingAi | create | ✓ |
| `/audit/versions` | GET,POST | apiPermission | versions | view,edit | ✓ |
| `/auth/login` | POST | authEndpoint, publicHealth, sessionUser | — | — | — |
| `/auth/logout` | POST | authEndpoint, publicHealth, sessionUser | — | — | — |
| `/auth/me` | GET | authEndpoint, publicHealth, sessionUser | — | — | — |
| `/auth/register` | POST | authEndpoint, sessionUser | — | — | — |
| `/dashboard` | GET | authEndpoint, sessionUser | — | — | ✓ |
| `/files/[id]/download` | GET | apiPermission | workspace | export | ✓ |
| `/files` | GET | apiPermission | workspace | view | ✓ |
| `/files/upload` | POST | apiPermission | workspace | create | ✓ |
| `/health` | GET | — | — | — | — |
| `/image-upscale/batches/[batchId]/zip` | GET | apiPermission | imageUpscale | view | ✓ |
| `/image-upscale/jobs/[id]/download` | GET | apiPermission | imageUpscale | view | ✓ |
| `/image-upscale/jobs/[id]` | GET,POST,DELETE | apiPermission | imageUpscale | view,edit | ✓ |
| `/image-upscale` | POST,GET | apiPermission | imageUpscale | create,view | ✓ |
| `/integrations/amazon/ads/changes` | GET,POST | amazonRead, apiPermission, sessionUser | settings | edit | ✓ |
| `/integrations/amazon/ads/data` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/integrations/amazon/ads/oauth/callback` | GET | apiPermission | settings | edit | ✓ |
| `/integrations/amazon/ads/oauth/start` | POST | apiPermission | settings | edit | ✓ |
| `/integrations/amazon/ads/profiles` | GET,POST | amazonRead, apiPermission | settings | view,edit | ✓ |
| `/integrations/amazon/ads/reports` | GET,POST | apiPermission, publicHealth | settings | view,edit | ✓ |
| `/integrations/amazon/ads/sync` | GET,POST | apiPermission | settings | view,edit | ✓ |
| `/integrations/amazon/sp-api/bindings` |  | apiPermission, authEndpoint, sessionUser | settings | edit | ✓ |
| `/integrations/amazon/sp-api/credentials` |  | apiPermission, authEndpoint, sessionUser | settings | edit | ✓ |
| `/integrations/amazon/sp-api/oauth/callback` | GET | amazonRead, authEndpoint, sessionUser | — | — | — |
| `/integrations/amazon/sp-api/oauth/start` | POST | apiPermission | settings | edit | ✓ |
| `/integrations/catalog` | GET | apiPermission | settings | view | ✓ |
| `/integrations/sellersprite` | GET,PUT,POST | apiPermission, authEndpoint | settings | view,edit | ✓ |
| `/integrations/sellfox/credentials` | GET,PUT,DELETE | authEndpoint, sessionUser | — | — | ✓ |
| `/integrations/sellfox/credentials/test` | POST | authEndpoint, sessionUser | — | — | ✓ |
| `/internal/amazon/execution` | POST | mcpBearer | — | — | — |
| `/jobs/[id]/retry` | POST | apiPermission | tasks | edit | ✓ |
| `/jobs/[id]` | GET | apiPermission, authEndpoint, sessionUser | tasks | view | ✓ |
| `/jobs` | GET | apiPermission | tasks | view | ✓ |
| `/lili/[...path]` |  | amazonRead, apiPermission, liliOAuth | — | — | — |
| `/lili/call-quota` | GET | apiPermission, authEndpoint, sessionUser | agents | view | ✓ |
| `/lili/devices` |  | amazonRead, apiPermission, liliOAuth | settings | — | ✓ |
| `/lili/oauth/[action]` |  | liliOAuth, mcpBearer | — | — | — |
| `/lili/pair` | POST | amazonRead, liliOAuth | — | — | — |
| `/listing-ai/chat-history` | GET,PUT | apiPermission | listingAi | view,edit | ✓ |
| `/listing-ai/chat` | POST | apiPermission | listingAi | create | ✓ |
| `/listing-ai/gallery-saves` | GET,POST | apiPermission | listingAi | view,edit | ✓ |
| `/listing-ai/generate-description` | POST | apiPermission | listingAi | create | ✓ |
| `/listing-ai/generate-images` | POST | apiPermission | listingAi | create | ✓ |
| `/listing-ai/generate-title` | POST | apiPermission | listingAi | create | ✓ |
| `/listing-ai/optimize` | POST | apiPermission | listingAi | create | ✓ |
| `/listing-ai/studio/export` | POST | apiPermission, authEndpoint, sessionUser | listingAi | export | ✓ |
| `/listing-ai/studio/rewrite` | POST | apiPermission | listingAi | create | ✓ |
| `/listing-ai/studio` | GET,POST | apiPermission | listingAi | view,create | ✓ |
| `/listing-ai/workspace` | GET,PUT | apiPermission | listingAi | view,edit | ✓ |
| `/mcp/amazon` | POST,GET | amazonRead, mcpBearer | — | — | — |
| `/mcp/sellfox` | POST,GET | mcpBearer | — | — | ✓ |
| `/notifications/user` | GET,PATCH | authEndpoint, sessionUser | — | — | — |
| `/notifications/wecom` | POST | apiPermission, authEndpoint, sessionUser | settings | view | ✓ |
| `/notifications/wecom/settings` | GET,PUT | apiPermission, authEndpoint | settings | view,edit | ✓ |
| `/observability/metrics` | GET | apiPermission, publicHealth | settings | view | ✓ |
| `/observability/vitals` | POST | publicHealth | — | — | — |
| `/operations/amazon-fx-rate` | GET,POST,DELETE | apiPermission | operations | view,edit | ✓ |
| `/operations/amazon-mcp` |  | amazonRead, mcpBearer, sessionUser | — | — | ✓ |
| `/operations/amazon-sku-cost` | GET,POST,DELETE | apiPermission | operations | view,edit | ✓ |
| `/operations/amazon-stores` |  | amazonRead, apiPermission | — | — | ✓ |
| `/operations/assembly` | GET,POST,PATCH | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/buybox-traffic-trend` | GET | apiPermission | operations | view | ✓ |
| `/operations/connection/validate` |  | apiPermission, authEndpoint, sessionUser | operations | edit | ✓ |
| `/operations/data-quality` | GET | apiPermission | operations | view | ✓ |
| `/operations/ext` | GET,POST | apiPermission | operations | — | ✓ |
| `/operations/fba-customs-profiles` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/fba-customs-templates` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/fba-local-labels` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/fba-local-plans` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/fba-remote-actions` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/fba-workflow-options` | GET | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/finance-attachments/[id]` | GET | apiPermission | operations | view | ✓ |
| `/operations/finance-attachments` | GET,POST | apiPermission | operations | view,create | ✓ |
| `/operations/finance-auxiliary` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-bank` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-catalog` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-close-reviews` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-expenses` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-external-sources` | GET,POST | amazonRead, apiPermission | operations | view | ✓ |
| `/operations/finance-fx-revaluations` | GET,POST | amazonRead, apiPermission | operations | view | ✓ |
| `/operations/finance-ledger` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-ledger/sources` | GET,POST | apiPermission | operations | view,create | ✓ |
| `/operations/finance-open-items` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-reports` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-structure` | GET | apiPermission | operations | view | ✓ |
| `/operations/finance-transaction-analytics` | GET | apiPermission | operations | view | ✓ |
| `/operations/finance-voucher-import` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/finance-voucher-import/workbook` | POST | apiPermission | operations | create | ✓ |
| `/operations/finance-voucher-templates` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/freshness` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/operations/inventory-health` | GET | apiPermission | operations | view | ✓ |
| `/operations/inventory/snapshots` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/operations/mcp-isolation` | GET,POST | amazonRead, apiPermission, mcpBearer | sellfox | view | ✓ |
| `/operations/metrics/daily` | GET | apiPermission, authEndpoint, sessionUser | operations | view | ✓ |
| `/operations/ops-extensions` | GET,POST | apiPermission | operations | — | ✓ |
| `/operations/procurement/approvals` | PATCH | apiPermission | operations | approve | ✓ |
| `/operations/procurement/invoices` | GET,POST,PATCH | apiPermission | operations | — | ✓ |
| `/operations/procurement/plans` | GET,POST,PATCH | apiPermission | operations | — | ✓ |
| `/operations/procurement` | GET,POST,PATCH | apiPermission | operations | create | ✓ |
| `/operations/product-period-analytics` | GET | apiPermission | operations | view | ✓ |
| `/operations/products/images/[fileId]` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/operations/products` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/operations/profit-report` | GET | apiPermission | operations | view | ✓ |
| `/operations/readiness` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/operations/replenishment-signals` | GET | apiPermission | operations | view | ✓ |
| `/operations/replenishment` | GET,PATCH | amazonRead, apiPermission | operations | edit | ✓ |
| `/operations/return-analytics` | GET | apiPermission | operations | view | ✓ |
| `/operations/schedules` |  | apiPermission, authEndpoint, sessionUser | operations | view | ✓ |
| `/operations/settlement-allocations` | GET,POST | apiPermission | operations | view | ✓ |
| `/operations/settlement-monthly-summary` | GET | apiPermission | operations | view | ✓ |
| `/operations/settlement-sku-pivot` | GET | apiPermission | operations | view | ✓ |
| `/operations/sku-profit-final` | GET | amazonRead, sessionUser | — | — | ✓ |
| `/operations/sync-center/approvals` | POST | apiPermission, mcpBearer | operations | view | ✓ |
| `/operations/sync-center/exports` |  | amazonRead, sessionUser | — | — | ✓ |
| `/operations/sync-center/replica` | POST | amazonRead, apiPermission | operations | create | ✓ |
| `/operations/sync-center` | GET,POST | amazonRead, apiPermission, mcpBearer | — | — | ✓ |
| `/operations/sync-runs` |  | apiPermission, authEndpoint, sessionUser | operations | create | ✓ |
| `/operations/wimoor-field-parity` | GET | apiPermission | operations | view | ✓ |
| `/operations/wms-aging-schedules` | GET,POST | apiPermission | wms | view,approve | ✓ |
| `/operations/wms-aging-snapshots` | GET,POST | apiPermission | wms | view,create | ✓ |
| `/operations/wms-cost-adjustments` | GET,POST | authEndpoint, publicHealth, sessionUser, wmsAccess | — | — | ✓ |
| `/operations/wms-inventory-risk` | GET,POST | wmsAccess | — | — | ✓ |
| `/operations/wms-overseas-charges` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/wms-stocktake-print` | GET | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/wms/[kind]` | GET,POST,PATCH | wmsAccess | — | — | — |
| `/operations/wms/approvals` | GET,POST | sessionUser, wmsAccess | — | — | ✓ |
| `/operations/wms/commands` | POST | sessionUser, wmsAccess | — | — | ✓ |
| `/points/adjust` | POST | pointsAccess | — | — | — |
| `/points/ledger` | GET | pointsAccess | — | — | — |
| `/points/override` | PUT,GET | pointsAccess | — | — | — |
| `/points/overview` | GET | pointsAccess | — | — | — |
| `/points/policy` | GET,PATCH | pointsAccess | — | — | — |
| `/points/price` | GET,POST | pointsAccess | — | — | — |
| `/points/requests/[id]` | POST | pointsAccess | — | — | — |
| `/points/requests` | GET,POST | pointsAccess | — | — | — |
| `/points/spend` | POST | pointsAccess | — | — | — |
| `/points/summary` | GET | pointsAccess | — | — | — |
| `/products/[sku]/detail` | GET | apiPermission | products | view | ✓ |
| `/products/[sku]/meeting-notes` | GET,POST,PATCH,DELETE | apiPermission | products | view,edit | ✓ |
| `/products/[sku]` | GET | apiPermission | products | view | ✓ |
| `/products/[sku]/video-plan` | GET,PUT | apiPermission | products | view,edit | ✓ |
| `/products/catalogs` | GET,POST | apiPermission | products | view,edit | ✓ |
| `/products/conclusion-files/[id]/download` | GET | apiPermission | products | view | ✓ |
| `/products/conclusion-files/upload` | POST | apiPermission | products | edit | ✓ |
| `/products/export/[id]/download` | GET | apiPermission | products | export | ✓ |
| `/products/export/[id]` | GET | apiPermission, authEndpoint, sessionUser | products | export | ✓ |
| `/products/export` | POST | apiPermission | products | export | ✓ |
| `/products/file-assets/[id]/download` | GET | apiPermission | products | view | ✓ |
| `/products/file-assets/upload` | POST | apiPermission | products | edit | ✓ |
| `/products/image-assets/upload` | POST | apiPermission | products | edit | ✓ |
| `/products/image-urls` | POST | apiPermission | products | view | ✓ |
| `/products/patent-files/upload` | POST | apiPermission | products | edit | ✓ |
| `/products` |  | apiPermission | products | view,edit,create | ✓ |
| `/products/video-assets/upload` | POST | apiPermission | products | edit | ✓ |
| `/saihu-search-merge/history` | GET,POST,DELETE | apiPermission | searchMerge | view,create,edit | ✓ |
| `/selection-research/[id]/report/[fileId]` | GET | apiPermission | agents | export | ✓ |
| `/selection-research/[id]/report` | GET | apiPermission, researchAccess | — | — | ✓ |
| `/selection-research/[id]` | GET,POST | apiPermission, researchAccess | — | — | ✓ |
| `/selection-research/discover` | POST | amazonRead, apiPermission, mcpBearer, researchAccess, sessionUser | — | — | ✓ |
| `/selection-research` | GET,POST | researchAccess | — | — | — |
| `/sellfox/[domain]/[id]` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/[domain]/export` | GET | apiPermission | sellfox | export | ✓ |
| `/sellfox/[domain]` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/ads-proposals` | GET,POST | apiPermission | sellfox | view,edit | ✓ |
| `/sellfox/dataset/export` | GET | apiPermission | sellfox | export | ✓ |
| `/sellfox/dataset` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/dimensions` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/endpoint-records` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/endpoints` | GET,POST,PATCH | apiPermission | sellfox | view,create | ✓ |
| `/sellfox/full-sync` | POST | apiPermission | sellfox | create | ✓ |
| `/sellfox/fx-rates` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/hub` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/order-detail` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/orders` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/overview` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/performance/export` | GET | apiPermission | sellfox | export | ✓ |
| `/sellfox/performance` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/reference-data` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/restock` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/sales` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/schedules` | GET,POST | apiPermission | sellfox | view,create | ✓ |
| `/sellfox/shipments` | GET | apiPermission | sellfox | view | ✓ |
| `/sellfox/store-grants` | GET,POST | apiPermission | sellfox | view | ✓ |
| `/sellfox/sync` | POST | apiPermission | sellfox | create | ✓ |
| `/skills/[slug]/export/[downloadId]` | GET | apiPermission | — | — | ✓ |
| `/skills/[slug]` | GET | apiPermission | — | — | ✓ |
| `/skills/[slug]/run` | POST | apiPermission | — | — | ✓ |
| `/skills` | GET | apiPermission | — | — | ✓ |
| `/skills/runs/[id]/document` | GET | apiPermission | — | — | ✓ |
| `/skills/runs/[id]` | GET | apiPermission | — | — | ✓ |
| `/skills/runs` | GET | apiPermission | — | — | ✓ |
| `/system/worker-health` | GET | apiPermission | settings | view | ✓ |
| `/user-preferences/[key]` | GET,PUT | authEndpoint, publicHealth, sessionUser | — | — | — |
| `/workspace/draft-runs` | GET,POST | apiPermission | workspace | view,edit | ✓ |
| `/workspace/snapshot` | GET,PUT,DELETE | apiPermission | workspace | view,edit | ✓ |
| `/workspace/workbook-files/[id]/download` | GET | apiPermission | workspace | view | ✓ |
| `/workspace/workbook-files/upload` | POST | apiPermission | workspace | edit | ✓ |
| `/workspaces/members` | GET | sessionUser, workspacesAccess | — | — | ✓ |
| `/workspaces` | GET,POST | authEndpoint, sessionUser, workspacesAccess | — | — | ✓ |

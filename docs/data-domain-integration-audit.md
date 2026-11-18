# 数据域接入能力审计报告（5 项）

> 审计日期：2026-11-19 · 基线：main `3922e39`
> 口径：区分「架构已实现（代码就绪，待真实数据验收）」与「真实缺口」。
> 本系统的设计前提是 `liveAcceptance=NOT_VERIFIED`——所有外部数据能力先落地代码，
> 待真实 SP-API / Ads / 赛狐授权后逐域验收。

## 逐项结论

| # | 能力 | 结论 | 关键证据 |
|---|------|------|----------|
| 1 | 赛狐凭证录入 + 全自动全量拉取 + 赛狐承接页 | **架构已具备** | 凭证 `src/lib/sellfox/credential-crypto.ts`（AES-256-GCM + AAD）、录入 `api/integrations/sellfox/credentials/route.ts`；自动同步 `scripts/sellfox-sync-worker.ts` + `sync-orchestrator.ts`；域清单 `src/lib/sellfox/data-plan.ts`；承接页 `src/app/(erp)/sellfox/*`（14 路由）；落库 `Sellfox*` 表 |
| 2 | Amazon Ads + SP 凭证 + 全自动全量拉取 + 亚马逊承接页 | **架构已具备** | Ads 凭证 `src/lib/amazon-ads/credentials.ts` + `api/integrations/amazon/ads/oauth/*`；SP OAuth `src/lib/amazon-sync/oauth.ts`；worker `scripts/amazon-sync-worker.ts` + `scheduler.ts` + `amazon-ads/sync-scheduler.ts`；账本 `src/lib/amazon/domain-architecture.ts`（SP 33/34、Ads 15/18，余为诚实标注的规划态）；承接页 `/operations?view=*` 与 `/amazon-ads/[[...view]]`；落库 `Amazon*` 表 |
| 3 | 两承接页数据隔离 | **架构已具备** | `src/lib/mcp/isolation.ts` 四层隔离：token 前缀（`amcp_` / `sfmcp_`）、端点拒绝、数据集白名单、只读 DB 角色（`AMAZON_MCP_PG_READONLY_URL` / `MCP_PG_READONLY_URL`）+ 表前缀；测试 `tests/mcp-isolation.test.ts`（12 例）、`mcp-db-isolation.test.mjs`、`remediation-isolation.test.ts` |
| 4 | 赛狐 MCP 只读本地承接页数据（非直连 API） | **架构已具备** | `src/lib/sellfox/mcp.ts` 无任何外部 HTTP 调用；`MCP_PG_READONLY_URL` + `BEGIN READ ONLY` + 超时保护；组织/店铺围栏强制注入；22 个数据集全量覆盖（`sellfoxDatasets` / `mcp-tool-registry.ts`）；端点 `api/mcp/sellfox` 仅接受 `sfmcp_` token |
| 5 | Amazon MCP 只读本地已落地数据（非直连 API） | **架构已具备** | `src/lib/amazon-sync/mcp.ts` 无 `fetch`；经本地 `verifiedSources` / `Amazon*` 表读取；`mcp-datasets.ts` / `mcp-tool-registry.ts`；端点 `api/mcp/amazon` 拒绝跨前缀 token 并审计 |

## 结论

**5 项能力的架构层全部具备（DONE_LOCAL / PASS），不是功能缺口**。两个承接页、凭证录入、自动全量同步、双 MCP 只读隔离读取均已落地代码并有测试锁定。

唯一未闭环项是 **`liveAcceptance=NOT_VERIFIED`**：需要真实 SP-API / Ads / 赛狐授权、生产 PostgreSQL/Redis、full gate 端到端、以及页面/MCP 回读一致性实测。这是设计上的诚实状态，不是代码缺陷。

## 追加发现：赛狐承接页性能优化（main2 分支）

远端 `main2` 有 3 个提交**尚未合并到 main**，均为赛狐数据域性能增强，与审计项 1 的「全量拉取」效率直接相关：

1. `fa3ca0c1` 赛狐慢查询整改 P1+P2（索引 / coverage 落列 / 画像窄表 / 预聚合 / 对账）
2. `fe9cbda4` 赛狐慢查询整改 P0 读缓存（Redis 读穿 + 前端内存缓存 + 失效 + 降级）
3. `c41ea0ea` MCP 跨源只读隔离加固（赛狐只读赛狐 / Amazon 只读 Amazon）

涉及 `result-cache.ts`、`agg-refresh.ts`、`listing-profile-refresh.ts`、`post-sync-projections.ts`、4 个 migration 与隔离测试增强。这些是**性能优化与隔离加固**，补齐后赛狐承接页的全量读取与 MCP 只读隔离更稳健。已在本次升级中评估并合并（见 git 历史）。

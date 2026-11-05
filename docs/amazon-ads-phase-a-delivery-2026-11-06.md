# Amazon Ads Phase A 交付记录

日期：2026-11-06

本阶段完成 Amazon Ads 共享数据架构、增量迁移、Repository 和统一查询服务。没有调用真实 Amazon Ads API、没有运行数据库迁移、没有修改凭证，也没有提交或推送 Git。

## 已完成

- 在已有 `AmazonAdsAuthorization`、`AmazonAdsProfile`、`AmazonAdsSyncPlan`、`AmazonAdsSyncTask`、`AmazonAdsEntityRecord`、`AmazonAdsReportFact` 和 `AmazonAdsReportVersion` 边界上做兼容式扩展。
- 为实体增加 Campaign/Ad Group/Keyword/Target 查询所需的规范字段，原始 `payload` 仍保留用于审计和兼容。
- 为报告事实增加 `currencyCode`，指标允许为 `NULL`，以区分“指标为零”和“该报告不提供该指标”。
- 增加 `AmazonAdsSyncDomainState`、`AmazonAdsSyncAttempt`、`AmazonAdsReportRequest` 和 `AmazonAdsReportDocument`，覆盖数据域 freshness、重试尝试、异步报告请求和文档元数据；文档通过 `FileObject` 的组织/工作区边界引用存储对象。
- 增加 Profile + Task 的复合约束和迁移前一致性检查，避免把记录跨 Profile 重新归属。报表查询只读取已发布版本和成功任务；兼容读取旧的 version-less 成功事实。
- 增加 `src/lib/amazon-ads/query-contract.ts`、`repository.ts` 和 `query-service.ts`。服务端统一处理 Profile/Marketplace/Seller 权限、搜索、状态、Campaign/Ad Group、日期、排序、分页、按币种汇总和 freshness envelope。
- 更新 `GET /api/integrations/amazon/ads/data` 为薄路由，保留 `rows` 兼容字段，同时返回 `data`、`pagination`、`scope`、`dateRange`、`source`、`syncedAt`、`freshness`、`totals` 和 `warnings`。
- 同步落库时保留原始响应，并投影常用实体字段；日报记录 Profile 币种。真实读取 adapter 仍保持 fail-closed。

## 尚未完成

- 迁移尚未应用到任何数据库；需要在隔离数据库审查 SQL 并运行约束/回滚验证。
- 新的 `SyncDomainState` 和 `SyncAttempt` 已有存储边界与 Repository；Sponsored Products 结构 Worker 的 Attempt、重试/租约恢复和结构域 freshness 生命周期在 Phase B 补齐。各报告类型 freshness 仍属于 Reports 后续验收。
- Sponsored Products 八类结构 adapter 已挂接隔离同步 worker 并通过 fixture 验证；真实 Amazon 请求仍关闭。Reports adapter 仍待逐 report type 核验字段与数据口径。
- 现有主工作台仍是 Demo/Mock；逐页切换属于 Phase E。已同步数据页可读取本地已保存事实。
- Ads 专用 MCP 只读结构工具已在本地 Phase F 切片完成；现有 SP-API MCP 凭证不自动获得该工具授权。

## 验证

- `npx prisma validate`、`npx prisma generate`、`npm run typecheck`：通过。
- `npm run test`：856/856 通过；变更文件定向 ESLint、`git diff --check`：通过。
- `npm run test:amazon-ads:offline`：结构同步 7/7、Ads MCP 6/6 通过；不连接真实数据库或 Amazon。
- `npx playwright test --config tests/browser/amazon-ads.config.ts`：13/13 通过；MCP 设置面板 2/2 通过。

完整生产构建未运行；全局 lint 会扫描工作区已有未跟踪 `.next-amazon-live/` 构建产物并产生第三方 bundle 警告，当前已用变更文件定向 ESLint 验证。合码前应清理或排除该产物后再运行完整 `npm run check`。

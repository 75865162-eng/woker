# Amazon Ads Phase C 交付记录

日期：2026-11-06

Phase C 在现有 Amazon sync worker、任务表和同步队列上补齐本地任务中心能力。实现与回归均使用隔离数据库、mock Ads transport 和浏览器 fixture；没有连接真实 Amazon API、执行持久数据库迁移、启用同步配置或部署。

## 已完成

- `GET /api/integrations/amazon/ads/sync` 支持 Profile、状态、页码和每页数量筛选，返回受限范围内的计划/freshness、任务历史、最新 Attempt 和分页 envelope。筛选参数有界校验，Profile 条件通过统一 `buildAdsProfileWhere` 组合 Seller 与 Marketplace grant；任务和 freshness 不跨越当前组织、工作区或授权 Profile。
- 响应继续使用字段白名单，不返回加密 checkpoint、lease owner 或 fencing/dispatch 内部值；读取写入既有 Amazon 数据审计。
- `GET /api/integrations/amazon/ads/profiles` 现在使用同一 Seller/Marketplace 访问范围。账户页的 Profile 筛选选项来自完整的已授权 Profile 列表，不再由最多 200 个计划反推，未授权站点不进入账户页和任务筛选器。
- `POST /api/integrations/amazon/ads/sync` 增加单任务取消操作。服务端要求现有设置管理权限，在 Profile 锁事务中做条件状态更新、递增 dispatch/fence、清理租约并结束当前活动 Attempt；已成功的历史 Attempt、检查点和已提交事实保留。取消会写审计和 freshness warning；已有成功 freshness 变为 stale 并保留其最后成功时间。取消与 worker claim/提交使用相同 fencing，过期 dispatch 在凭证刷新或 Ads 请求前停止。
- 暂停同步计划时同样结束当前任务 Attempt；只更新各任务最新的运行中/等待重试 Attempt，不改写已完成历史 Attempt。
- 账户页现有后台布局内加入任务状态/Profile 筛选、服务端分页、状态/Attempt/错误摘要展示、取消确认和取消后刷新。空历史、首次加载、请求错误和取消结果均有状态提示。状态选项覆盖等待适配器/配置状态。

## 修改文件

- `src/app/api/integrations/amazon/ads/sync/route.ts`
- `src/app/api/integrations/amazon/ads/profiles/route.ts`
- `src/lib/amazon-ads/authorization.ts`
- `src/lib/amazon-ads/sync-service.ts`
- `src/components/amazon-ads/ads-accounts.tsx`
- `tests/integration/amazon-ads.integration.ts`
- `tests/browser/amazon-ads.spec.ts`

## 验证

- `npm run test:amazon-ads:offline`：结构同步/查询/权限/取消 17/17、MCP 只读集成 10/10；包含 Marketplace/Profile 隔离、任务筛选分页、取消 fencing、最新 Attempt 结束、旧 dispatch 在 HTTP 前停止、已成功 freshness 保留，以及 Profile 列表授权过滤。
- `npm run test:amazon-ads:offline -- --reports`：报表发布与查询隔离 15/15。
- `npx playwright test --config tests/browser/amazon-ads.config.ts tests/browser/amazon-ads.spec.ts`：21/21；覆盖 Profile 选项、服务端筛选/分页、取消确认和刷新。
- `npm run test`：860/860；`npm run typecheck`：通过。
- 涉及文件的定向 ESLint：0 errors，`ads-accounts.tsx` 留有一条现有 `useEffect` 依赖 warning。`git diff --check`：通过。
- 未跑默认 `check:fast` 或完整 build。工作区已有未跟踪 `.next-amazon-live/` 构建目录会进入默认 lint 扫描；此次以核心测试、定向 ESLint 和 TypeScript 完成分级验证。合码/上线前再按 AGENTS.md 盘点全改动区并运行完整门禁。

## 尚未完成与风险边界

- 尚无独立审计事件时间线；任务详情与分页 Attempt 时间线已在下方补充记录。
- 当前 freshness 只展示结构域。报表 freshness 必须依赖完整发布版本和日期覆盖，不能借用结构状态。
- 页面和 fixture 不能证明授权 Amazon Profile 已产生真实数据、完成历史覆盖或实体删除；真实 API、正式同步、运行配置、migration 和凭证仍按目标环境另行审查。
- 数据库事实与同步记录未删除。代码回滚可恢复同步/Profile API 原有范围和账户页任务中心行为；回滚不应清理事实数据或任务历史。

## 后续补充：任务详情与 Attempt 时间线（2026-11-06）

- 详情读取先在当前组织、工作区及可见 Profile 范围内定位任务；越权与不存在统一返回 404。任务详情请求不再先读取账户页计划列表。
- Attempt 时间线支持服务端分页，接口页大小上限 50、账户页默认 10。报告请求和版本各最多显示 20 条、每个请求文档最多 10 份，并返回总数及截断提示。
- 任务详情继续使用字段白名单：不包含 checkpoint、lease/fence/dispatch、错误原文、报告请求选项、Amazon 远端请求 ID、存储文件 ID、内容哈希或下载地址。错误摘要限长 300 字；文档 BigInt 字节数按十进制字符串返回。
- 账户页在既有任务历史下展示任务范围和计数、Attempt、报告请求/文档/发布版本状态及 Profile freshness；未新增布局、Schema 或迁移。
- 验证：`npm run test:amazon-ads:offline` 中结构/查询/权限/取消18/18、MCP只读10/10；Ads浏览器22/22；TypeScript、定向ESLint与 `git diff --check` 通过。使用隔离数据库、模拟 API 和浏览器 fixture。
- 审计事件独立时间线尚未实现。Reporting freshness 仍需基于发布版本和日期覆盖另行收口；fixture 不能证明授权 Profile 的真实 Amazon 数据采集。

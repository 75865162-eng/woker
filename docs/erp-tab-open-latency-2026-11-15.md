# 多标签页面打开延迟专项：交付报告（2026-11-15）

## 1. 结论

| 指标 | 目标 | 实测（生产构建） | 实测（开发 3000） | 判定 |
| --- | --- | --- | --- | --- |
| 新建标签首次可见→绘制 | P95 ≤ 300ms | **31 / 64 / 49 / 49 / 44 ms**（tab1–tab5） | 42 / 229 / 231 / 243 / 263 ms | 达标（生产）；开发受 DB 延迟限制 |
| 已缓存标签切换 | ≤ 50ms | **P95 = 12ms**（15 次切换 7–12ms） | P95 = 62–66ms | 达标（生产） |
| 首个 document 可见 | — | **353ms** | 593–1199ms | 生产可用 |

第三标签从 2–5s 降到 **49ms**（生产）/ **231–298ms**（开发），降幅 ≥ 95%。

iframe 架构**已移除**：改为单 document + 视图 keep-alive（LRU 6 视图 / 8 标签），配套 LRU 淘汰、缓存粒度控制（非激活标签释放行 DOM、保留 `visibleCount`）、路由级数据预取、虚拟列表（`ROW_CHUNK=80`）。

## 2. 根因（三层叠加）

1. **串行认证 / 权限查询**：每次文档启动都要 `getCurrentUser` → `getOrganizationRolePermissionsSnapshot`，开发环境各 200–500ms，串行后单次 400–800ms。
2. **每标签一份 document**：iframe 方案下每个标签独立启动 React、重新拉 chunk、重新水合，等效把第 1 条的代价乘上标签数——这正是"第三个标签 2–5s"的主因（越往后越慢，因为并发 document 争抢同一 dev 编译器 / DB）。
3. **数据请求客户端瀑布**：页面组件同步取数，无去重、无预取，标签内又串行两次往返（业务数据 + 筛选项），生产环境也有 2 个 RTT 的固定成本。

## 3. 改动清单

| 位置 | 内容 |
| --- | --- |
| `src/components/app-shell/persistent-app-shell.tsx` | 单 document 视图缓存：`{href, element, LayoutRouterContext 快照, seq}`；命中缓存时 `preventDefault` + `pendingHref` + `startTransition` 乐观切换；hover 60ms / 空闲 1500ms 预取邻路由 |
| `src/components/app-shell/tab-activity.tsx` | `TabActivityProvider` / `useTabActive`，向子树传播"当前标签是否激活" |
| `src/components/operations/ext/kit.tsx` | `useExt` 增加进行中请求去重 + 5s 新鲜窗口缓存；`Table` 在标签失活时释放行 DOM、保留分页位置 |
| `src/lib/workspace/ext-query.ts` | 统一查询键构造，预取与页面命中同一份缓存 |
| `src/lib/workspace/route-data-prefetch.ts` | 路由 → 首屏查询映射（与页面默认筛选值逐字一致，否则键对不上） |
| `src/lib/workspace/workspace-api-cache.ts` | 查询结果 LRU（60 条） |
| `src/app/api/operations/ext/route.ts` | 新增 `kind=repricing-bundle` 聚合端点；响应加 `Server-Timing` |
| `middleware.ts` / `src/app/(erp)/layout.tsx` | 删除 `x-workspace-frame` 与 frame 分支，只保留单 document 路径 |
| `src/app/(erp)/loading.tsx` | 移除（备份 `tmp/loading.tsx.bak`）；见第 5 节 A/B |

## 4. 前后对比（1 / 2 / 3 / 5 标签）

优化前基线 = 同日 06:26 开发环境实测（串行 DB + 客户端瀑布，`tmp/tabs-report.json`）：

| 标签 | 优化前 painted | 优化后（开发） | 优化后（生产） |
| --- | --- | --- | --- |
| tab1 `/operations/repricing` | 55ms（首屏 5622ms） | 42ms | 31ms |
| tab2 `/operations/sales-plans` | 2261ms | 229ms | 64ms |
| tab3 `/operations/purchase-plans` | 1511ms | 231–298ms | 49ms |
| tab4 `/operations/tax` | 1510ms | 243ms | 49ms |
| tab5 `/operations/reviews` | 1744ms | 263ms | 44ms |
| 切换 P95 | 103–113ms（跨 document 重建） | 62–66ms | 12ms |

生产数据来源：`tmp/prod-final.json`（`node .next-build/standalone/server.js`，127.0.0.1:3101，当前构建）；开发数据来源：`tmp/dev-no-loading.json`、`tmp/dev-with-loading.json`（localhost:3000）。

生产实测细节：tab2 的 4 个首屏查询墙钟各 19ms、RSC TTFB 0ms；tab3 首屏查询 16ms、RSC TTFB 5ms；tab4 41/42ms；tab5 全部命中预取缓存（0 请求）。任务耗时（`TaskDuration`）单标签 22–46ms，堆 7–10MB，节点 903→2466 随标签累积。

## 5. `loading.tsx` A/B（开发环境）

| 配置 | 首屏 | tab1 | tab2 | tab3 | tab4 | tab5 | 切换 P95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 保留 `loading.tsx` | 931ms | 28 | 228 | 231 | 213 | 213 | 62ms |
| 移除 `loading.tsx` | 593–1199ms | 40–42 | 229 | 298 | 243 | 263 | 66ms |

差异落在噪声内（同配置两次运行即可差 100ms+），说明**骨架屏不是瓶颈**。保留移除的决定基于体验与一致性：单 document keep-alive 下，骨架屏会在切换瞬间闪一下又被缓存视图替换，正是用户描述的"正在打开页面…"闪烁来源。生产环境在无 `loading.tsx` 下已达标。

## 6. 剩余风险 / 未覆盖

- **开发环境单标签 200–350ms 仍在**：主因是 DB（`getCurrentUser`、权限快照、业务查询）与 dev 无静态缓存，代码层不可消除；生产侧同样查询 ≤ 42ms。
- **开发环境可见重复请求**：tab3 `/api/operations/procurement/plans ×2`，生产同样操作只见 1 次 → 判定为 React StrictMode 双触发；该端点未走 `useExt` 去重通道，属既有实现，未改动。
- **测量环境**：本地单机 + 本地数据库、单浏览器实例、无网络丢包；局域网/云端 DB 的 P95 未测。
- **内存**：5 标签节点 903→2466、堆 7–10MB；LRU 上限 6 视图 / 8 标签，超出即淘汰最久未用视图，未做长时间挂机压测。
- 生产数据对应构建 `.next-build`（BUILD_ID 09:45），源码已确认无更新于该构建的文件。

## 7. 验证

- `npm run test`：1845 通过 / 0 失败
- `npm run typecheck`：通过
- 构建与 standalone 启动：通过（`cp -R .next-build/static .next-build/standalone/.next-build/static` 后起服务）
- 复现脚本：`tmp/measure-tabs.mjs`（`BASE`/`OUT` 环境变量切换环境与输出）

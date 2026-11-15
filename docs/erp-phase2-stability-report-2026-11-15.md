# 第二阶段：全 ERP 性能稳定性验收报告（2026-11-15）

架构基线：iframe → 单 Document + Keep-Alive 已完成（第三标签首次可见 49ms、缓存切换 P95 12ms）。
本阶段**不做架构改造**，只做稳定性验证与定点修复。所有数据来自真实浏览器（Playwright + CDP），生产构建 `.next-build/standalone`（127.0.0.1:3101），测试身份 `1 / 123`。

## 一、重复请求：根因与修复

### 1.1 结论

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 出现重复 GET 的路由数（共 59 条） | **19 条**，同一条查询 2–4 次 | **0 条** |
| 59 条路由 GET 总数 | — | 110 |
| 隐藏视图被连带重发的查询 | 每次切标签都会重发 | **0 次**（连开 6 页验证） |
| 开发环境 StrictMode 双触发导致的成双请求 | `procurement/plans` ×2 | **1 次**（StrictMode 未关闭） |

### 1.2 三个独立原因（先分离，再修）

1. **隐藏视图订阅了「当前路由」**（真实生产问题，主因）
   保活视图各自渲染 `useSearchParams()` / `usePathname()`，Next 的这两个 hook 读的是全局路由上下文，不是视图自己的地址。于是每切一次标签，**所有**隐藏视图都跟着重渲染，并各自按「新参数」重跑 effect（同步中心 `section=settings|sources|overview` 因此在 inventory / logistics / sellfy 等页面重复 2–4 次）。
   修法：`KeptView` 为每个视图快照 `PathnameContext` + `SearchParamsContext`（`next/dist/shared/lib/hooks-client-context.shared-runtime`），隐藏视图只看到自己那一页的地址。
   证据：打开 tax 页后再连开 6 个页面，tax 的查询重发次数 = **0**。

2. **未接入统一去重的 raw `fetch`**（真实生产问题）
   `procurement/plans`、`procurement?view=suppliers`、`sync-center?section=*` 都是组件各自 `fetch`，同一查询被两个组件同时发起时无法合并。
   修法：新增统一入口 `src/lib/workspace/get-json.ts`：

   ```ts
   getJson<T>(url, { headers })   // 同一工作区 + 同一 URL 的在途 GET 只发一次
   ```

   - **只合并「进行中」的请求**，请求结束即释放，不缓存结果 → 数据实时性不变；
   - key 含 `x-workspace-id`，跨工作区不共享（租户隔离）；
   - **仅 GET**，`POST/PATCH/PUT/DELETE` 一律不经过该入口（写操作显式声明方法）；
   - 失败/异常立即清空在途记录，重试可以重新发请求。
   接入点：`purchase-plans-workbench`、`user-notification-center`（15s 轮询）、`sync-center-workbench`（probe + load）、`procurement-workbench`、`purchase-supplier-picker`。

3. **React StrictMode 双触发**（开发环境现象，非生产问题）
   开发模式下 effect 会跑两遍，`purchase-plans` 的首次载入因此出现 ×2。**未关闭 StrictMode**；统一入口把两次并发调用合并成一次网络请求，dev 复测已为 1 次。
   生产本来就不会双触发——生产重复请求全部由原因 1、2 造成。

### 1.3 未纳入统一去重的部分（明确边界）

- 全部写请求（`extPost`、`POST /api/operations/procurement/plans` 等）；
- 带 `AbortController` 的搜索型请求（取消语义与共享结果冲突，保持各自发起）；
- 仍散落在 60+ 文件里的 raw `fetch`（本次只接入了有实测重复证据的 5 处）。新增代码应使用 `getJson`。

## 二、LRU 状态恢复

### 2.1 做法

- `MAX_TABS` 8 → **20**（ERP 实际使用常在 10–20 标签；标签只是元数据，不占页面状态）。
- `MAX_VIEWS` 保持 **6**：超出按 LRU 淘汰最久未用的页面视图。
- 新增 `src/lib/workspace/use-draft-state.ts`：未提交表单草稿写 `sessionStorage`（按工作区隔离、关闭标签即失效），视图被淘汰重新挂载时回填，**提交成功后显式 `clearDraft()`**，避免下次进页面看到旧值。
  已接入：销售计划（表头 + SKU 行草稿）、采购计划（需求推算表单）、商品列表（搜索/筛选、排序、当前页、每页条数）。

### 2.2 实测（淘汰 7 次后重新进入，生产构建）

| 用例 | 淘汰前 | 淘汰后 | 恢复耗时 |
| --- | --- | --- | --- |
| 商品页：搜索 / 列排序 / 翻页 | `search=LRU-SEARCH-1`，按中文名升序 | **保留**，重进后请求带 `search=LRU-SEARCH-1&sortBy=chineseName&sortDirection=asc` | 25–30ms |
| 销售计划：计划名称 / 预测窗口 | `LRU-DRAFT-2` / `123` | **保留** | 7–8ms |
| 采购计划：销量窗口 / 覆盖天数 | `45` / `75` | **保留** | 7–8ms |
| 滚动位置、弹窗、展开行、需求推算结果 | — | 未保留（见下表定性） | — |

### 2.3 三类状态的处理口径

| 类别 | 具体项 | 处理 | 理由 |
| --- | --- | --- | --- |
| **必须持久保留** | 未提交表单（计划名称、日期、天数、SKU 行、备注）、列表搜索词、筛选条件、排序、当前页、每页条数 | `sessionStorage` 草稿（`useDraftState`） | 丢了要用户重打，属输入成果 |
| **可以重新加载** | 列表数据、KPI、ext 查询结果、同步状态 | 视图淘汰后重新取数；`useExt` 有 5s 新鲜窗口 + 内存 LRU，重进通常命中缓存（实测 1 次请求或 0 次） | 服务端是唯一事实源，重取不产生歧义 |
| **应当销毁** | 弹窗/抽屉、提示条、展开行、临时勾选（如采购建议勾选）、二次确认 | 随组件卸载销毁，不恢复 | 恢复旧弹窗会打断当前操作，属错误行为 |

滚动位置由外壳按 `href` 记忆，视图重建后回填；本次用例被搜索条件收敛成 1 行，页面不可滚动，**该项未能给出有效数据**（见 4.3）。

## 三、长期内存压力

采集方式：CDP `Performance.getMetrics` + `HeapProfiler.collectGarbage`（先强制 GC 再读数），`detachedEstimate = Nodes − 活动 DOM 节点 − Documents`（估算值）。

| 标签数 | 视图数 | JS Heap | DOM 节点 | Event Listener | Detached（估） | 淘汰后重进耗时 | 重进 API 请求 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 5 | 6 MB | 1940 | 533 | 663 | 8ms | 0 |
| 10 | 6 | 7 MB | 2754 | 636 | 1091 | 10ms | 1 |
| 15 | 6 | 8 MB | 2498 | 576 | 1257 | 7ms | 1 |
| 20 | 6 | 9 MB | 2339 | 643 | 933 | 9ms | 1 |

视图恒为 6（LRU 生效），标签数达到上限 20 后不再增长（实测 `[role=tab][title]` = 20）。

100 次连续切换（4 页循环，每 25 次采样）：

| 次数 | Heap | 节点 | Listener | Detached（估） |
| --- | --- | --- | --- | --- |
| 25 | 7 MB | 1649 | 483 | 516 |
| 50 | 7 MB | 1649 | 483 | 516 |
| 75 | 7 MB | 1649 | 483 | 516 |
| 100 | 7 MB | 1649 | 483 | 516 |

四条曲线完全持平 → **未观察到内存持续增长**。API 缓存上限 60 条（`workspace-api-cache.ts`），超出淘汰最久未命中键；本压测未触顶。

## 四、全 ERP 页面覆盖（59 条侧栏路由）

### 4.1 总体

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| p50 | 35ms | **37ms** |
| p90 | — | 336ms |
| p95 | 352ms | **350ms** |
| max | 11425ms（单次异常） | **394ms** |
| 超时（>15s 无内容） | 1 | 0 |

### 4.2 最慢 8 条（修复后）

| 路由 | 首屏 | API 个数 / 合计 | DOM 节点 |
| --- | --- | --- | --- |
| `/dashboard` 商品主档 | 394ms | 3 / 93ms | 1823 |
| `/settings` 系统设置 | 352ms | 4 / 52ms | 3399 |
| `/tasks` 任务中心 | 350ms | 1 / 32ms | 1217 |
| `/workspace` PPC Bulk 优化 | 347ms | 2 / 29ms | 3237 |
| `/versions` 版本审计 | 346ms | 1 / 13ms | 1885 |
| `/logistics` 物流文件工作台 | 336ms | 0 | 1724 |
| `/listing-ai` | 335ms | 2 / 23ms | 3487 |
| `/listing-ai/studio` | 332ms | 2 / 103ms | 4126 |

覆盖到的模块：商品管理、销售、Amazon Ads、采购、仓库/物流、财务、数据中心、AI 与工具、账号与设置。全站 max 394ms，远低于 300ms 新标签目标的 2 倍口径内的个例，**无长尾页面**。

### 4.3 需说明的三处异常

1. `/operations?view=fba-boxing` 首轮审计 11425ms。隔离复测 **43ms**；在该页面之前先打开 12 个标签再进 **15ms**，无长任务（0 条 longtask）。判定为审计会话中前序重表格页面积压的主线程占用，非该页面自身问题，原始数字保留在 `tmp/audit-routes.jsonl`（已被后续覆盖，数值见本表）。
2. 两处 403（非性能问题，但属真实缺陷）：
   - `/api/operations/sync-center?section=sources`（同步中心子页在无该权限的身份下仍会请求）；
   - `/api/integrations/amazon/ads/data?kind=entities`（无 Ads 权限时仍请求）。
   建议在发请求前做权限判断，避免每个页面白跑一次 403；本次未改权限逻辑。**（第三阶段已处理：改为明确空态并在无授权时停止轮询，见 `docs/erp-phase3-hardening-2026-11-15.md`）**
3. 滚动位置用例无效：搜索词把列表收敛成 1 行，页面不可滚动，无数据可比。

## 五、改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `src/lib/workspace/get-json.ts` | **新增**：统一 GET 在途去重入口（工作区隔离、仅 GET、不缓存结果） |
| `src/lib/workspace/use-draft-state.ts` | **新增**：sessionStorage 表单草稿，视图淘汰后回填，提交成功清除 |
| `src/components/app-shell/persistent-app-shell.tsx` | `KeptView` 增加 `PathnameContext` / `SearchParamsContext` 快照 |
| `src/components/app-shell/workspace-tabs.tsx` | `MAX_TABS` 8 → 20 |
| `src/components/operations/purchase-plans-workbench.tsx` | GET 走 `getJson`；表单接草稿 |
| `src/components/operations/ext/sales-plans-workbench.tsx` | 表头与 SKU 行接草稿，保存成功清除 |
| `src/components/products/product-workbench.tsx` | 搜索/筛选、排序、页码、每页条数接草稿 |
| `src/components/notifications/user-notification-center.tsx` | 15s 轮询 GET 走 `getJson` |
| `src/components/operations/sync-center-workbench.tsx` | probe / load 走 `getJson` |
| `src/components/operations/procurement-workbench.tsx` | 列表 GET 走 `getJson` |
| `src/components/operations/purchase-supplier-picker.tsx` | 供应商 GET 走 `getJson` |
| `tests/get-json-dedup.test.ts` | **新增** 6 项：并发合并、结束后重取、工作区隔离、非 2xx 不抛错、失败后可重试、只发 GET |

## 六、验证与剩余风险

验证：

- `npm run test`：**1851 通过 / 0 失败**（原 1845 + 新增 6）
- `npm run typecheck`：通过
- 生产构建：通过；standalone 启动需 `cp -R .next-build/static .next-build/standalone/.next-build/static`
- 复现脚本：`tmp/audit-routes2.mjs`（全站）、`tmp/test-lru-state.mjs`（状态恢复）、`tmp/test-memory.mjs`（内存）、`tmp/probe-hidden-refetch.mjs`（隐藏视图重发）

剩余风险：

1. 仍有 60+ 处 raw `fetch` 未接入统一去重，只在有实测证据处接入；新增代码需自觉使用 `getJson`。
2. `useDraftState` 依赖 sessionStorage：隐私模式/配额满时退化为内存状态（表现为淘汰后丢草稿），已 catch 不报错。
3. ~~草稿按工作区隔离但不按用户隔离~~ **已在第三阶段修复**：key 加入 userId（`工作区:用户:页面:字段`）。
4. 内存数据来自单浏览器实例、本地 SQLite 库。20 标签以上已在第三阶段补测（连开 25/30 页：标签恒定 20、视图 6、堆 8.8–9.7MB），挂机 3 分钟指标全平；小时级仍未测。
5. `detached` 为估算值（CDP 不直接暴露 detached DOM），趋势可用、绝对值仅供参考。
6. ~~两处 403 未修复~~ **已在第三阶段修复**：服务端加 `AMAZON_SCOPE_EMPTY` 错误码，前端改为中性空态并停止轮询；鉴权判定未放松。

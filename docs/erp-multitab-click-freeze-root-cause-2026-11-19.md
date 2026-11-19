# ERP 多标签页「点击假死」专项排查与根因修复（2026-11-19）

> 对应任务附件：`改动假死.txt`。全程遵循"先找根因、再改代码"：第一阶段只读审计 → 第二阶段 dev-only 诊断 → 第三阶段 A–H 复现 → 第四阶段问题清单与修复 → 第五阶段验收。禁止用刷新、强制重渲染、setTimeout 延迟点击掩盖问题。

## 1. 系统多标签页架构分析

单 document 多标签外壳 `WorkspaceShell`（`src/components/app-shell/persistent-app-shell.tsx`）：

- **标签栏** = 访问过页面的索引（`WorkspaceTab[]`，上限 `MAX_TABS=8`），持久化到 `sessionStorage`。
- **保活视图** = 每页的 RSC 子树 `element` + 登记那一刻的路由分段上下文快照 `context`，存于 `views`（`CachedView[]`，上限 `MAX_VIEWS=6`，按 `seq` 做 LRU）。
- `KeptView`（`memo`）用隐藏 DOM 保留组件状态；只有四个 props 全稳（`href`/`visible`/`element`/`context`）时才跳过调和。这是切换性能与"状态不丢"的关键。
- `useTabActive()` 让长表格在标签转入后台时释放行级 DOM。
- 当前激活视图严格跟随真实路由 `shownHref = currentHref`，不再使用历史上的 `pendingHref` 乐观切换（该优化已在早前迭代移除）。
- 导航 `<Link>` 一律 `prefetch={false}`，禁用 RSC 预取，仅保留 hover/空闲的数据级预热，避免预取与导航请求竞争。

历史背景：`docs/erp-tab-open-latency-2026-11-15.md` 记录过"第三标签 2–5 秒"延迟，由 iframe→单 document、RSC 乐观切换等改造解决。本次假死是**不同层面的第三个根因**，与那次延迟无关。

## 2. 故障根因报告

### 2.1 为什么前期修复没解决

只读审计确认：当前代码已无 `pendingHref` 乐观切换、已无 `router.prefetch` RSC 预取竞争；`upsertView` 状态机单页唯一、LRU、seq 单调不变量全部成立。基础状态机无缺陷。因此症状不在 tab 增删/激活逻辑本身。

### 2.2 决定性证据（dev-only 诊断快照）

在 `/lili` 页面**完全静止**（无点击、无路由变化、无请求）3 秒采样：

| 指标 | 修复前 | 对照页面（初始 tab） |
| --- | --- | --- |
| 视图 render 增量 | **≈ 1000 / 3s** | 0 |
| 外壳 render（3s） | 1664 | 0 |
| `children` 引用变化 | 0 | — |
| `configuration` 引用变化 | 0 | — |
| `display` state 变化 | 2 | — |
| `segmentContext` 引用变化 | **824** | — |
| 每视图 mount 次数 | 1（无重复挂载） | 1 |
| JS 异常 / pending 请求 | 0 / 0 | 0 / 0 |

归因链（引用签名探针实测）：

```
Next router 内部状态刷新
  → useContext(LayoutRouterContext) 返回新引用 segmentContext（824 次）
  → 外壳传给激活视图 KeptView 的 context prop = segmentContext（live）
  → KeptView 的 memo 被击穿（elementId 恒为 1、children 0 变化，唯一变的是 context）
  → /lili 整棵子树重渲染（contextId 一路涨到 829）
  → 主线程被无效渲染占满 → 表现为「连续打开多个页面后点击无响应/切换卡顿」
```

**P0 根因**：激活视图的 `context` 注入了 Next 每帧刷新的 live `segmentContext`，击穿 `KeptView` 的 `memo`。这是"点击假死"的主因——不是 tab 状态竞争，不是内存泄漏，不是请求堆积（这三类实测均无异常）。

**P1 根因（次生）**：`AI 与工具` 一级/二级导航指向纯 redirect 跳板页 `/ai/lili`（服务端 `redirect("/lili")`）。点击后 tab 身份分裂为"`/ai/lili` 幽灵 tab + `/lili` 实际 tab"，redirect 延迟落地会覆盖用户紧随其后的导航，侧栏高亮也因 `getModuleIdForPath("/ai/lili") === null` 失效。表现为"点了商品管理却停在 /lili"的假死。

> **最终修复方案演进**：协作者同期合入「7 板块二级命名空间重构」，要求所有二级入口用本板块前缀（`/ai/*`），不能直接改成 `/lili`（会破坏命名空间约束）。故采用更本质的方案：在 `namespace-routes.ts` 配 `/ai/lili → /lili` 的**服务端 rewrite** 并删除 `/ai/lili/page.tsx` redirect 跳板。rewrite 保持浏览器 URL / tab 身份稳定为 `/ai/lili`，内容直达 `/lili`，既满足命名空间约束又彻底消除跳板。同步更新了 `tab-shell-architecture.test.ts` 静态守卫、A–H / decisive / many-pages 测试的 URL 期望。

## 3. 涉及的代码文件清单

| 文件 | 角色 |
| --- | --- |
| `src/components/app-shell/persistent-app-shell.tsx` | 外壳核心；P0 修复点 |
| `src/components/app-shell/business-navigation.ts` | 7 板块导航定义；P1 修复点（AI 入口用 `/ai/lili` 命名空间） |
| `src/lib/navigation/namespace-routes.ts` | P1 修复点：新增 `/ai/lili → /lili` 服务端 rewrite |
| `src/app/(erp)/ai/lili/page.tsx` | 已删除原 redirect 跳板（否则文件系统路由优先于 afterFiles rewrite） |
| `src/lib/app-shell/tab-navigation-diagnostics.ts` | 新增 dev-only 诊断监控（生产 no-op） |
| `src/components/app-shell/workspace-tabs.tsx` | 加 `data-workspace-tabbar` / `data-tab-href` 便于精确测试 |
| `tests/tab-shell-architecture.test.ts` | 新增静态架构守卫，CI 每次 PR 拦截复发 |

## 4. 每个问题的修复说明

### P0 — 激活视图注入不稳定 context 击穿 memo

- **原因**：见 §2.2。`KeptView` 的 `context` prop 对当前激活视图用了 live `segmentContext`，Next 每次 router 内部刷新都换引用。
- **代码位置**：`persistent-app-shell.tsx` 渲染 `KeptView` 处（原 `context={view.href === currentHref ? segmentContext : view.context}`）。
- **修复方案**：激活视图同样使用登记时快照 `view.context`。新页面在 `needsRegister` 分支用当时的 `segmentContext` 登记快照；RSC 更新由 effect 用 `latestContext` 重建快照，配对始终正确。另将 `segmentContext` 从 effect 依赖移除，改由 ref 读取最新值，消除每次 router 抖动触发的无效 effect 调度。
- **修复前表现**：`/lili` 静止 3s render ≈1000，外壳 1664，导航被拖延至 15s 超时。
- **修复后表现**：`/lili` 静止 render **0**，`RENDER_BY_HREF./lili` 从 2610 降到 **4–10**，A–H 全部通过。
- **约束遵守**：未用刷新/强制重渲染/setTimeout 延迟点击；未删功能；未大改无关模块。

### P1 — 导航跳板页导致 tab 身份分裂与导航覆盖

- **原因**：见 §2.2。
- **代码位置**：`business-navigation.ts` AI 板块入口 href、`namespace-routes.ts` rewrite 表、`src/app/(erp)/ai/lili/page.tsx`（已删）。
- **修复方案**：导航入口保持本板块命名空间 `/ai/lili`（符合协作者命名空间重构约束），在 `namespace-routes.ts` 新增 `{ href: "/ai/lili", destination: "/lili" }` 由 next.config 服务端 rewrite 直达真实 Lili 页；删除会优先于 afterFiles rewrite 的 `/ai/lili/page.tsx` redirect 跳板。URL / tab 身份稳定为 `/ai/lili`，侧栏高亮用 `getModuleIdForPath("/ai/lili") === "agents"` 正常。同步更新 A–H / decisive / many-pages 测试 URL 期望与静态守卫。
- **修复前表现**：点"AI 与工具"后 URL `/ai/lili`→延迟跳 `/lili`，再点"商品管理"回弹停在 `/lili`（decisive 第 3 步 `switched:false`，15s 超时）。
- **修复后表现**：decisive 四步全部 `switched:true`，渲染维持低位；`/ai/lili` 导航不再产生幽灵 tab。

### P1（内存泄漏 / 重复挂载 / 请求堆积）— 未发现

诊断实测：`mountByHref` 每视图恒为 1、`errors=0`、`requestsPending` 归零、`requestsStarted===requestsEnded`、JS Heap 稳定。**无此类缺陷，无需修复**。

### P2 — 隐藏页资源浪费

`useTabActive()` 已在 `src/components/operations/ext/kit.tsx` 让长表在后台释放行级 DOM。本次 P0 修复后隐藏视图不再因 context 抖动重渲染，隐藏页资源浪费一并消除。

## 5. 修改文件清单

（见 §3 表格中实际改动项；测试文件见 §6）

## 6. 自动化测试结果

- A–H 复现测试（`tests/e2e/tab-navigation-repro.spec.ts`）：A/B/C/D/F/G/H 共 7 项通过，E（10 分钟长稳）按设计默认跳过。
- 决定性对照（`tests/e2e/tab-click-decisive.spec.ts`）：4 步全部 `switched:true`；对照实验 20 次切换全部成功。
- 隔离实验（`tests/e2e/tab-lili-isolation.spec.ts`）：初始 tab / `/lili` 静止 / 切走后 render 增量全部 0。
- 12 页面压测（`tests/e2e/tab-many-pages.spec.ts`）：通过——连续打开 12 个不同页面（7 一级板块 + 5 亚马逊二级视图），tab 数被 `MAX_TABS=8` 正确约束、始终只有一个可见视图、老 tab 可关闭、关闭后仍可切换、errors=0。
- 单元测试：`tests/persistent-app-shell-views.test.ts`、`tests/tab-navigation-diagnostics.test.ts`。
- 质量门禁：
  - `npm run test`：2543 项中 **2542 通过**，唯一失败 `代码和部署门禁拒绝低于22.19的Node` 是环境基线问题（本机 Node 22.13.1 < 门禁 22.19），与本次改动无关。
  - `npm run lint`：**0 error**（5 个既有 warning，均已存在；本次已清掉其中我碰过的 1 个）。
  - `npx tsc --noEmit`：**通过**。
  - `npm run build`：**通过**（生产构建成功）。
  - `npm run ui:guard`：3 处范式突破（原生 `<table>`、硬编码 `text-[11px]`、任意值 `min-w-[1100px]`），全部来自 HEAD 已合入的 `OrderDetailWorkbench.tsx`（协作者订单详情功能），本次改动文件无一涉及；属既有基线债务，按最小修改原则不代为改动。

## 7. 修复前后性能对比

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| `/lili` 静止 3s 视图 render | ≈1000 | **0** |
| 4 步导航实验总 render | 2646（`/lili` 2610） | **18** |
| 单步导航耗时 | 商品管理 15s 超时（回弹） | 商品管理 6.4s / 亚马逊 3.8s 正常落地 |
| 长任务 / JS 异常 | 6 / 0 | 4–5 / 0 |
| 重复挂载 / pending 请求 | 1 / 0 | 1 / 0 |

## 8. 尚未解决的问题及风险

- **E 长稳测试**默认跳过（10 分钟），需 `E2E_SLOW=1` 显式运行；本次未执行。
- **诊断探针**保留在代码中但仅开发环境生效，生产构建 `captureTabEvent`/`installTabDiagnostics` 为 no-op，对最终用户零成本、零行为影响。
- `/ai/lili` 现由服务端 rewrite 直达 `/lili`，外部书签访问该路径 URL 保持 `/ai/lili`、内容正确，无跳板、无 tab 分裂。
- 本次为 dev 环境 E2E 验证；生产部署后建议用同套 A–H 冒烟复核一次。
- **既有基线债务（非本次引入）**：本机 Node 22.13.1 低于 `production-readiness` 门禁要求的 22.19，`check:fast`/单测中该项固定失败；`ui:guard` 因协作者已合入的 `OrderDetailWorkbench.tsx` 使用原生 `<table>` / `text-[11px]` / `min-w-[1100px]` 而突破基线 3 处。两项均与本次多标签修复无关，未代为修改无关业务代码。

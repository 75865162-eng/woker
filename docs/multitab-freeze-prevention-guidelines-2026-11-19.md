# 多标签「点击假死」复发预防规范

> 适用范围：`WorkspaceShell` 单文档多标签外壳及其承载的业务页面。
> 背景：2026-11-19 发生过一起因「活跃视图注入 live `LayoutRouterContext` 击穿 `memo`」引发的渲染风暴，
> 表现为主线程被无效渲染占满、真实导航被拖延（点击假死）。根因见
> `docs/erp-multitab-click-freeze-root-cause-2026-11-19.md`。本规范给出可执行的防复发红线与门禁。

## 一、四条代码红线（Code Review 必查）

| # | 红线 | 反例（会引发假死） | 正确做法 |
|---|---|---|---|
| 1 | `KeptView` 的 `context` 只能用**登记时的稳定快照** `view.context` | `context={view.href === currentHref ? segmentContext : view.context}` | 一律 `context={view.context}`；`segmentContext` 只在 `upsertView` 登记时写入一次 |
| 2 | 登记/同步 view 的 effect **不得依赖 live `segmentContext` 引用** | `useEffect(..., [children, currentHref, segmentContext])` | 依赖只留 `[children, currentHref]`；需要最新路由上下文时用 `segmentContextRef.current` 读取 |
| 3 | 命名空间入口必须用**服务端 rewrite** 落地，不得用 page.tsx 的 `redirect()` 跳板 | `/ai/lili/page.tsx` 里 `redirect("/lili")` | 导航用本板块命名空间 `href="/ai/lili"`，在 `namespace-routes.ts` 配 `destination: "/lili"` 由 rewrite 直达；删除 redirect 跳板页 |
| 4 | 诊断/埋点代码必须在生产构建中 **no-op** | 生产环境照常执行 `PerformanceObserver` / `console.error` 包装 | 全部 `if (process.env.NODE_ENV !== "production")` 守卫 |

**为什么这四条是关键**：红线 1/2 直接对应渲染风暴的传导链（live context → memo 击穿 → 子树空转）；
红线 3 对应"点了 A 却停在 B"的导航覆盖；红线 4 保证排查工具不成为新的生产负担。

## 二、三层自动化门禁

### 第 1 层：静态架构守卫（CI 每次 PR 必跑，零登录依赖）

`tests/tab-shell-architecture.test.ts` 从源码层面锁死上述红线 1/2/3/4：
- 断言 `KeptView` 的 `context` prop 不含 `segmentContext`、必须含 `view.context`；
- 断言所有 `useEffect` 依赖数组不含 `segmentContext`，且存在 `segmentContextRef`；
- 断言 AI 导航组一级/`ai.lili` 子项为 `/ai/lili` 命名空间路径，且 `namespace-routes.ts` 有 `/ai/lili → /lili` 的 rewrite、不存在 `/ai/lili/page.tsx` redirect 跳板；
- 断言诊断模块有 `NODE_ENV` 守卫。

该文件由 `npm run test` 自动纳入（CI 已运行），**任何人改回旧写法都会让 CI 变红**。
修改外壳时若确实需要调整 context 传递方式，必须同步更新此守卫并说明理由，禁止直接删除断言。

### 第 2 层：运行期回归测试（本地 / CI 有测试账号时跑）

- `tests/e2e/tab-lili-isolation.spec.ts`：量化 `/lili` 静止期 render 增量。
  **健康基线**：静止 3 秒 render 增量为 **0**；若 > 50 视为渲染风暴回归。
- `tests/e2e/tab-navigation-repro.spec.ts`：A–H 全场景（多板块、50 次切换、快速点击、关闭重开、长稳、接口异常、大量页面、刷新恢复）。
- `tests/e2e/tab-click-decisive.spec.ts`：四步连续导航，验证 URL/tab/视图三者一致、`renders` 处于低位。
- `tests/e2e/tab-many-pages.spec.ts`：连续打开 12 个不同页面，验证 LRU 淘汰下仍可切换、老 tab 可关闭。

> CI 目前未跑 Playwright（仅单测）。若后续为 CI 配置了 `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`，
> 应把 `tab-lili-isolation` 与 `tab-navigation-repro` 加入 CI 的 E2E 步骤（参见 `.github/workflows/ci-cd.yml`
> 已安装 chromium，只差测试账号与执行步骤）。在此之前，第 1 层静态守卫是 CI 的主要防线。

### 第 3 层：dev-only 诊断监控（线上问题即时取证）

`src/lib/app-shell/tab-navigation-diagnostics.ts` 常驻 dev 环境，暴露 `window.__WOKER_TAB_DIAG__.snapshot`，
记录 click/route/mount/unmount/render/request/error/longtask/heap 及引用稳定性签名。
排查新问题时先取快照，用数据定位，禁止凭直觉认定"React/路由/内存"问题后再打补丁。

## 三、新增一级导航 / 视图的准入检查

1. 新增命名空间入口时，目标 href 用本板块前缀（如 `/ai/lili`），落地方式用 `namespace-routes.ts`
   的 `destination` rewrite（服务端直达），**不要**新建 page.tsx 调用 `redirect()`——客户端 redirect
   跳板会让 tab 身份分裂并覆盖后续导航。
2. 新增会被 `KeptView` 保活的重量级页面（大表、表单、图表）时，在页面内用
   `useTabActive()` 让后台视图释放行级 DOM（参考 `operations/ext/kit.tsx`）。
3. 涉及外壳 `children` / `context` / `views` 流转的改动，必须跑第 1 层守卫 + 第 2 层隔离测试。

## 四、红线被突破时的处置

1. 先取诊断快照，确认 render 增量与引用变化签名，复现后再改（不未经验证就下结论）。
2. 修复只用"稳定引用/快照/正确依赖"这类根因手段，**禁止**：刷新页面、强制重渲染、`setTimeout` 延迟点击、
   无条件 `memo` 掩盖。
3. 修复必须同时补/更新第 1 层静态守卫，确保同类问题在 CI 阶段即被拦截。

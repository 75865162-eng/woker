# 第三阶段：剩余缺口补完（2026-11-15）

第二阶段报告（`docs/erp-phase2-stability-report-2026-11-15.md`）列了 6 条剩余风险，本轮把其中可闭环的部分做完，并补上第二阶段没测到的两项：高标签数（>20）与长时间挂机。

结论先说：

| 缺口 | 状态 | 关键数据 |
| --- | --- | --- |
| 无 Amazon 授权时请求 403 并显示红色报错 | **已修** | 改为明确空态；无授权时不再每 30s 轮询 |
| 草稿按工作区隔离但不按用户隔离 | **已修** | key 变为 `工作区:用户:页面:字段`，实测已带用户 id |
| 页面滚动位置（keep-alive 下） | **已修** | 三条切换路径全部回到原位（1200/900/1500） |
| 20 标签以上、长时间挂机未测 | **已补测** | 连开 25/30 页：标签恒定 20、视图 6、堆 8.8–9.7MB |
| 长周期切换内存 | **已补测** | 200 次切换：节点/监听器完全持平，堆 9.7→10.4MB 后走平 |
| 60+ 处 raw fetch 未接入统一去重 | 保持现状 | 全站审计 0 条路由出现重复请求，无证据不动 |

---

## 一、无 Amazon 授权：从「红色报错」改为「明确空态」

### 1.1 问题

第二阶段审计里 21 条路由各出现一次 403，实际是同一类：

```
GET /api/operations/sync-center?section=sources&page=1&after=0
→ 403 {"error":"当前用户没有已分配的 Amazon 账号。"}
GET /api/integrations/amazon/ads/data?kind=entities&...
→ 403 {"error":"当前用户没有已分配的 Amazon 账号。"}
```

这是**正确的鉴权结果**（账号确实没有任何 Seller 数据授权），但前端把它当成故障页面渲染：整块红色 `role="alert"`，同步中心还会每 30 秒再打一次同样的 403。

### 1.2 做法（不改权限判定，只改「如何表达」）

1. `SyncInputError` 增加可选 `code`（`src/lib/amazon-sync/policy.ts`），向后兼容。
2. `explicitAmazonDataAccess` 的「无授权」分支抛 `code: "AMAZON_SCOPE_EMPTY"`（`src/lib/amazon-sync/data-access.ts`）。
3. 两条路由把 code 透传出去：`sync-center`、`integrations/amazon/ads/data`。
4. 客户端识别：
   - 同步中心：命中 code → `scopeEmpty` 状态，显示中性提示，并**停止 30s 轮询**（无授权时轮询只是白跑）。
   - 广告活动工作区：`useLocalRead` 命中 code → `AdsScopeEmptyError` → 渲染中性空态而不是 `role="alert"` 报错。

鉴权逻辑一行没放松：没有授权依然拿不到任何数据，只是不再以「系统故障」的样式呈现。

### 1.3 实测

```
/operations?view=inventory  alerts=[]  status="当前账号未分配 Amazon 卖家账号，Amazon 同步状态与数据暂不可见。…"
/amazon-ads/campaigns       alerts=[]  status="当前账号未分配 Amazon 卖家账号 …"
```

接口侧仍返回 403 + `"code":"AMAZON_SCOPE_EMPTY"`（401/403 语义不变，安全边界不变）。

---

## 二、草稿：补上用户维度

原 key 是 `tiaotiao.draft.<workspaceId>:<页面>:<字段>`，同一标签页换账号会读到上一个账号的输入。改为四段：

```
tiaotiao.draft.<workspaceId>:<userId>:<页面>:<字段>
```

`userId` 取自 app shell 上下文（`useAppShellUser`），取不到时退化为 `anonymous`，不影响功能。

实测（在生产构建里往采购计划表单输入后读 sessionStorage）：

```
tiaotiao.draft.default:cmwght5v10001xm8oxy11b3v0:purchase-plans:form
```

---

## 三、滚动位置：真正的根因是路由导航把页面滚回顶部

### 3.1 现象与时间线

第二阶段这条用例被判为「无效」（搜索词把列表收敛成 1 行，页面不可滚动）。本轮换成内容高度 3000px 的页面重测，暴露出真问题：

```
滚动到 y=1200 → 切到 /dashboard → 切回
采样（每 40ms）：t=12ms y=1200（恢复成功） → t=32ms y=0（被推回顶部）
```

即：本组件的恢复逻辑是生效的，但 20ms 后 **Next 的路由导航默认「滚动到顶部」** 又把它抹掉了。另外原实现依赖 `scroll` 事件记录位置，切换瞬间隐藏视图会让文档高度骤减、浏览器把 `scrollY` 归 0，这个「布局收缩」产生的滚动事件会把旧页面记成 0。

### 3.2 改法（`persistent-app-shell.tsx`）

1. **切换前记录**：点击链接 / 点标签 / 关标签切换时，先用 `window.scrollY` 落一次当前页位置，不等滚动事件。
2. **屏蔽布局收缩的杂音**：`restoringRef` 在恢复窗口期内忽略 `scroll` 事件，避免把「被折叠导致的 0」写进缓存。
3. **接管滚动**：保活切换的 `router.push(href, { scroll: false })`，滚动位置完全由本组件按标签维护。
4. **双 rAF 重试**：缓存视图重新显示时内容高度可能晚一帧才稳定（表格/图片），补两次 `requestAnimationFrame` 再落最终值。

### 3.3 实测（生产构建）

| 路径 | 滚动位置 | 结果 |
| --- | --- | --- |
| 侧栏 A→B→A | 1200 | 回到 1200 ✅ |
| 侧栏 A→B→C→A | 900 | 回到 900 ✅ |
| 标签栏点击切回 | 1500 | 回到 1500 ✅ |

修复前：无（三条路径都回到 0）。

---

## 四、补测：高标签数 / 长周期 / 长时间挂机

测试环境：生产 standalone（`127.0.0.1:3101`），CDP 指标，每次采样前强制 GC。

### 4.1 连开 25 / 30 个页面（标签上限 20）

| 连开页面数 | 标签数 | 挂载视图 | 被淘汰 | JS Heap | DOM 节点 | Listener | 淘汰后重进 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 20 | 6 | 14 | 8.8MB | 2311 | 683 | 20ms |
| 30 | 20 | 6 | 14 | 9.7MB | 2786 | 781 | 10ms |

- `MAX_TABS=20` / `MAX_VIEWS=6` 按预期生效：连开 30 个页面，标签不会无限增长。
- 文档数恒为 2（主文档 + 1），没有出现「每个标签一份 document」的回退。
- 淘汰后重进 10–20ms，比冷启动快一个量级。

### 4.2 连续切换 200 次

| 轮次 | Heap | 节点 | Listener |
| --- | --- | --- | --- |
| 0（基线） | 9.7MB | 2815 | 729 |
| 50 | 9.9MB | 2815 | 729 |
| 100 | 10.2MB | 2815 | 729 |
| 150 | 10.4MB | 2815 | 729 |
| 200 | 10.5MB | 2815 | 729 |

节点与监听器**逐次采样完全持平**；堆在 150 轮后走平（+0.7MB 属于 V8 堆分代/缓存对象，非单调增长）。

### 4.3 挂机 3 分钟（20 标签常驻）

| 时间 | Heap | 节点 | Listener |
| --- | --- | --- | --- |
| 30s | 10.4MB | 2815 | 729 |
| 60s | 10.4MB | 2815 | 729 |
| 90s | 10.4MB | 2815 | 729 |
| 120s | 10.4MB | 2815 | 729 |
| 150s | 10.4MB | 2815 | 729 |
| 180s | 10.4MB | 2815 | 729 |

完全平线。业务轮询（如通知中心 15s）没有造成累积。

---

## 五、全站回归（59 条侧栏路由）

| 指标 | 第二阶段 | 本轮 | 判读 |
| --- | --- | --- | --- |
| p50 | 37ms | 44ms | 噪声 |
| p95 | 350ms | 355ms | 噪声 |
| max | 394ms | 372ms | 略好 |
| 有重复请求的路由 | 0 | **0** | 无回归 |
| 出现 4xx 的路由 | 21 | 21 | 同一批「无 Amazon 授权」403，UI 已改为空态 |

最慢 6 条：`/dashboard` 372ms、`/workspace` 356ms、`/listing-ai/studio` 355ms、`/logistics` 352ms、`/tasks` 352ms、`/settings` 351ms —— 与上一轮同量级，无新增长尾。

---

## 六、本轮改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lib/amazon-sync/policy.ts` | `SyncInputError` 支持可选 `code` |
| `src/lib/amazon-sync/data-access.ts` | 无授权分支抛 `AMAZON_SCOPE_EMPTY` |
| `src/app/api/operations/sync-center/route.ts` | 错误响应透传 `code` |
| `src/app/api/integrations/amazon/ads/data/route.ts` | 错误响应透传 `code` |
| `src/components/operations/sync-center-workbench.tsx` | 识别空态、中性提示、无授权时停轮询 |
| `src/components/amazon-ads/ads-campaign-workspace.tsx` | `useLocalRead` 识别空态，`ReadState` 支持 `scopeEmpty` |
| `src/lib/workspace/use-draft-state.ts` | 草稿 key 加入 `userId` |
| `src/components/app-shell/persistent-app-shell.tsx` | 滚动位置：切换前记录、屏蔽布局收缩事件、`scroll:false`、双 rAF 重试 |

## 七、验证

- `npm run test`：**1851 通过 / 0 失败**
- `npm run typecheck`：通过
- `eslint`（改动文件）：通过
- 生产构建：通过；standalone 启动仍需 `cp -R .next-build/static .next-build/standalone/.next-build/static`
- 复现脚本：`tmp/test-stress.mjs`（25/30 标签、200 次切换、挂机、滚动）、`tmp/test-scroll.mjs`（滚动三路径）、`tmp/probe-scope-empty.mjs`（空态渲染）、`tmp/probe-draft-key.mjs`（草稿 key）、`tmp/audit-routes2.mjs`（全站）
- 数据文件：`tmp/stress-final.json`、`tmp/audit-routes3.jsonl`

## 八、仍然存在的风险（如实记录）

1. **21 条路由各打一次 403**：账号无 Amazon 授权时，页面仍会发一次 Amazon 读请求（然后被正确拒绝）。前置探测需要额外一次请求或把授权快照塞进 shell 上下文，收益不抵成本，未做。
2. **amazon-ads 模块的请求不带 `x-workspace-id`**：这些接口落回 `default` 工作区。当前部署工作区就是 `default`，行为正确；一旦多工作区并行，需要统一改造（涉及跨模块工作区边界，未擅动）。
3. **仍有 60+ 处 raw fetch 未接入统一去重**：全站审计 0 重复，按「无证据不动」保留；新代码应使用 `getJson`。
4. **挂机只测 3 分钟**：小时级未测；但 3 分钟内堆、节点、监听器三条线全平，无增长趋势。
5. **标签上限 20 是硬上限**：超过后最旧标签被挤掉（含未提交草稿的视图，草稿已落 sessionStorage，重进可回填）。
6. 测量为本地单机 + 本地库、单浏览器实例；云端 DB / 弱网未覆盖。

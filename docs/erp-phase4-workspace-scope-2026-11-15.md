# ERP 第四阶段：工作区作用域收口 + 30 分钟挂机观察（2026-11-15）

> 承接 `docs/erp-phase3-hardening-2026-11-15.md`。第三阶段把「无 Amazon 授权 403」「滚动位置」「草稿用户维度」补完后，遗留清单里的第 2 条写的是「amazon-ads 模块的请求不带 `x-workspace-id`」。本轮去核验这一条，结论是**描述不准，但底下压着一个更实在的缺陷**：工作区 id 有两套存储键，业务代码读的那一套从来没人写。

---

## 一、核验：先证明现象，再改代码

### 1.1 现象核验（生产构建，真实浏览器抓请求头）

抓 `/api/*` 请求头：

| 场景 | 样本量 | 缺 `x-workspace-id` |
| --- | --- | --- |
| 打开 `/operations/repricing` 后依次进 `/amazon-ads/campaigns`、`/accounts`、`/reports` | 全部 `/api/*` 请求 | **0 条** |
| 硬加载 `/amazon-ads/campaigns`（新 document 首批请求） | 4 | **0 条** |

原因：`WorkspaceScopeSelector` 里有一个全局 `fetch` 补丁 `patchFetchWithWorkspaceScope()`，会给所有同源 `/api/*` 请求注入 `x-workspace-id` / `x-account-id` / `x-marketplace`。所以第三阶段「amazon-ads 不带工作区」的判断不成立——**当时 3101 跑的是更早的一次构建，选择器根本没挂载**（见 4.3）。

### 1.2 真正的问题：两套键，一套是死键

| 位置 | 读/写的键 |
| --- | --- |
| `workspace-scope-selector.tsx`（唯一写入方） | 写 `amazon_bulk_ad_workspace_scope`（同时写 cookie） |
| `ext-headers.ts`、`use-draft-state.ts`、`assembly / purchase-plans / ops-extensions / purchase-invoices` 四个工作台 | 读 `tiaotiao.workspace.scope` |

全仓搜索确认 `tiaotiao.workspace.scope` **只有读、没有写**，因此这些位置恒等于 `default`：

- `extHeaders()` 永远发 `x-workspace-id: default`（当下被全局补丁覆盖成正确值，属于「碰巧对」）；
- **草稿 key 永远是 `default:用户:页面:字段`**——这是实打实的缺陷：切换工作区后，A 工作区的未提交录入会留在界面上，下一次输入写进 B 工作区的抽屉，反过来也会把 A 的草稿显示在 B 里。租户边界在浏览器侧漏了一个口子。

---

## 二、修复：工作区作用域单一来源

新增 `src/lib/workspace/workspace-scope-store.ts`：

```ts
export const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";   // 选择器唯一写入
const legacyWorkspaceScopeStorageKey = "tiaotiao.workspace.scope";          // 只在主键缺失时回退

export function readWorkspaceScopeId() {          // 主键 → 旧键 → default
export function workspaceScopeHeaders(json?)       // 统一构造 x-workspace-id（+ content-type）
```

收口范围：

| 文件 | 改动 |
| --- | --- |
| `workspace-scope-store.ts` | 新增：键常量、`readWorkspaceScopeId`、`workspaceScopeHeaders`；旧键仅作回退，避免升级后老草稿凭空消失 |
| `ext-headers.ts` | `extHeaders()` 改为委托，逻辑只剩一处 |
| `use-draft-state.ts` | 草稿 key 改读统一来源；并监听 `workspaceScopeChanged`，切换工作区时改读新工作区的草稿（**不把 A 的录入搬到 B**） |
| `workspace-scope-selector.tsx` | 键常量改为引用同一常量 |
| `assembly / purchase-plans / ops-extensions / purchase-invoices` 工作台 | 删掉各自复制的 `scopeKey + workspaceId() + headers()` 三行，改为引用统一实现 |
| `procurement-workbench.tsx` | 同一份复制逻辑（它读的是主键，行为本来就对）一并收口，避免以后漂移 |

设计取舍：切换工作区时表单回到新工作区的草稿（没有草稿则回到初始值）。因为每次输入都已按工作区落 sessionStorage，**切回原工作区仍能恢复原草稿**，不会真的丢数据；反过来「把 A 的输入留在 B 的界面上」才是更危险的那一边。

---

## 三、实测

### 3.1 草稿按工作区隔离（生产构建，真实输入）

在采购计划表单依次操作：A 输入 → 切到 B → 在 B 输入 → 切回 A。

| 步骤 | sessionStorage 草稿 key | 表单值 |
| --- | --- | --- |
| 在 `ws-verify` 输入 `DRAFT-IN-A` | `tiaotiao.draft.ws-verify:<userId>:purchase-plans:form` | `DRAFT-IN-A` |
| 切到 `ws-other` | 仍只有 A 的那条 | `90`（回到初始值，**未带过去**） |
| 在 B 输入 `DRAFT-IN-B` | 新增 `tiaotiao.draft.ws-other:<userId>:purchase-plans:form`，A 的条目原样保留 | `DRAFT-IN-B` |
| 切回 `ws-verify` | 两条并存 | **`DRAFT-IN-A`（恢复）** |

修复前这两次输入会落进同一个 `default:<userId>:...` key，来回切换看到的是后一次的内容。

### 3.2 请求头

选择器挂载确认：`window.__amazonBulkAdScopedFetchPatched === true`、页面存在「选择工作区」下拉、`amazon_bulk_ad_workspace_scope` 已写入 localStorage 与 cookie。所有 `/api/*` 请求（含 amazon-ads 的 `profiles` / `sync` / `data`）均带 `x-workspace-id`。

### 3.3 全站 59 条侧栏路由回归

本轮改动后重跑审计（`tmp/audit-routes4.jsonl`）：

| 指标 | 第三阶段 | 本轮 |
| --- | --- | --- |
| p50 | 44ms | 40ms |
| p90 | 344ms | 344ms |
| p95 | 355ms | 352ms |
| max | 372ms | 390ms |
| 有重复请求的路由 | 0 | **0** |
| 出现 4xx 的路由 | 21 | 21（同一批无授权 403） |

最慢 6 条：`/dashboard` 390ms、`/logistics` 361ms、`/workspace` 352ms、`/settings` 348ms、`/saihu-search-merge` 347ms、`/listing-ai/studio` 344ms，与上一轮同量级。

### 3.4 30 分钟挂机（20 标签常驻，CDP + 强制 GC）

| 时点 | Heap | DOM 节点 | Listener | Documents | 标签 | 视图 | 缓存切换 | 淘汰后重进 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 起始 | 8.8MB | 2363 | 643 | 2 | 20 | 6 | - | - |
| 5 分钟 | 8.8MB | 2363 | 643 | 2 | 20 | 6 | 14ms | 见下文 |
| 10 分钟 | 8.7MB | 2252 | 630 | 2 | 20 | 6 | 12ms | 40ms |
| 15 分钟 | 8.7MB | 2183 | 658 | 2 | 20 | 6 | 14ms | 24ms |
| 20 分钟 | 8.7MB | 2052 | 623 | 2 | 20 | 6 | 11ms | 22ms |
| 25 分钟 | 8.9MB | 2149 | 630 | 2 | 20 | 6 | 14ms | 55ms |
| 30 分钟 | 8.9MB | 1944 | 596 | 2 | 20 | 6 | 14ms | 38ms |
| 测试结束并重进 | 9.2MB | 2497 | 672 | 2 | 20 | 6 | - | 35ms |

堆内存全程 **8.7–8.9MB**，结束时重开页面后为 9.2MB；标签/保活视图/documents 数量始终稳定。DOM 与 listener 数随 LRU 视图淘汰有台阶变化，未出现持续增长。每 5 分钟验证一次缓存切换为 11–14ms；淘汰页重新进入在稳定采样中为 22–55ms，结束时 `/dashboard` 为 35ms。

5 分钟采样出现一次新路由 `freshOpenMs=9250ms`，后续 10/15/20/25/30 分钟分别为 40/24/22/55/38ms。该单次冷请求是离群值，未与稳定的缓存切换混算；不能据本轮挂机样本认定新路由打开始终低于 300ms，完整路由性能仍以第 3.3 节的 59 路由审计为准。

---

## 四、过程中的两个发现（影响测量可信度，记下来）

1. **3101 上曾跑着更早的构建**：`WorkspaceScopeSelector` 未挂载、`__amazonBulkAdScopedFetchPatched` 为 `false`。这也是第三阶段把「amazon-ads 不带工作区」写进风险清单的直接原因。现在每次重建后都会先跑一次选择器/静态资源校验（`tmp/probe-ws2.mjs`），再采数据。
2. **`/api/workspaces` 当前只有一个 `default` 工作区**，所以「多工作区」只能在浏览器里改写作用域键来验证（3.1 的做法）。真实多工作区部署还需要在数据库里建第二个工作区才能端到端复测。

---

## 五、验证

- `npm run test`：**1856 通过 / 0 失败**（新增 `tests/workspace-scope-store.test.ts` 5 项：主键优先、旧键回退、双缺省 default、损坏 JSON 不抛、请求头 content-type）
- `npm run typecheck`：通过
- `eslint`（改动文件）：通过
- 生产构建：通过；standalone 启动仍需先 `cp -R .next-build/static .next-build/standalone/.next-build/static`
- 复现脚本：`tmp/test-ws-draft.mjs`（草稿隔离）、`tmp/probe-headers.mjs` / `tmp/probe-headers2.mjs`（请求头）、`tmp/probe-ws2.mjs`（选择器挂载）、`tmp/audit-routes2.mjs`（全站）、`tmp/test-idle-long.mjs`（30 分钟挂机）
- 数据文件：`tmp/audit-routes4.jsonl`、`tmp/idle-long.json`

## 六、仍然存在的风险

1. **21 条路由各打一次 403**：无 Amazon 授权时仍会发一次读请求再被拒。前置探测需要额外一次请求或把授权快照塞进 shell 上下文，收益不抵成本，未做（与第三阶段结论一致）。
2. **全局 fetch 补丁依赖选择器挂载**：补丁在 `WorkspaceScopeSelector` 的 effect 里安装。极端情况下选择器不渲染，amazon-ads 这类没有显式头的调用点会回落到服务端默认工作区。本轮收口后，业务侧显式取工作区的地方已不再依赖补丁，但 ads 的 12 处 `fetch` 仍走补丁——要彻底摆脱，需要逐处改造，收益有限。
3. **60+ 处 raw fetch 未接入统一去重**：全站审计 0 重复，按「无证据不动」保留。
4. **服务端仍以 `organizationId` + 客户端 `x-workspace-id` 组作用域**：越权由组织边界兜住，工作区 id 本身可被客户端改写（既有设计，本轮未改）。
5. 测量为本地单机 + 本地 SQLite、单浏览器实例；云端 DB / 弱网未覆盖。

## 七、后续独立复核与加固（2026-11-15 夜间）

本节是后续代码核验和隔离验证，不将前述浏览器/真实服务历史记录当作本次重新验收。

### 7.1 已独立核实

- 原始 `tmp/audit-routes4.jsonl` 有 59 行：复算 painted 的 p50/p90/p95/max 为 40/344/352/390ms，重复请求路由 0；21 条路由记录请求失败及 403 控制台日志。
- 原始 `tmp/idle-long.json` 有 30 个分钟样本，Heap 8.7–8.9MB；缓存切换 11–14ms，单次冷打开 9250ms 与后续 22–55ms 如前文。仅复核原始文件，未重新执行 30 分钟挂机。
- ads 实际存在 17 处 fetch，而非此前风险清单的 12 处。
- 服务端已经有组织内工作区存在性校验（`assertWorkspaceAccess`），因此不能笼统描述成“仅信任客户端工作区”；现有组织成员合同不等于逐工作区成员 ACL。

### 7.2 本次完成

1. `workspace-scope-store.ts` 统一读取工作区、账号、站点完整快照，校验字段类型。显式请求头同时包含有效账号和站点，不再依赖全局补丁补齐。
2. ads 五个组件 17 处 fetch 全部显式带作用域头。新增局部 `ads-scope-boundary.tsx`：组织/用户/工作区/账号/站点变化重挂载业务体，清除旧筛选与数据，阻止旧实例继续推进异步操作序列；同一作用域事件不重复挂载，无额外轮询。
3. 全局 fetch 补丁只填缺省，不覆盖操作已绑定的工作区，也不把 B 的账号/站点拼接到 A 的显式请求。不同源请求不注入。
4. 选择器先成功写存储再提交 UI 状态和事件；存储被禁用时保持原工作区并展示失败提示，避免界面 B / 请求 A。
5. 草稿引入 `draft-storage.ts`，按组织、工作区、用户、表单 key 隔离；未确认身份不读写持久化。输入写入移出 React updater，旧 A 提交持有的 clearDraft 只清理 A，不清掉 B。
6. **草稿行为变更**：无组织维度的旧草稿保留、不删除，但不自动认领或迁移，避免跨组织误回填；升级后旧草稿不会自动出现在新命名空间。
7. `api-permissions.ts` 对 body/context/query/header 中所有明确工作区值 trim、去重并校验，不让合法 query 遮蔽非法 header；非法类型拒绝，至多查询四个不同 ID，防重复参数放大查询。保持现有业务 scope 解析顺序，不新增 ACL 模型。
8. `report-service.ts` 的报表采集概览以 Prisma AND 同时保留用户授权 Seller 条件和有效 Seller 条件，修复同名字段覆盖导致授权过滤失效。

### 7.3 本次验证与限制

- 最终无凭据环境 `npm run test`：**1871 通过 / 0 失败**（约 25 秒）。不加载根 `.env`，不继承数据库/API 凭据。
- 新增/扩展测试涉及：作用域存储和选择器、草稿存储与 hook、权限冲突、ads 请求头、报表账号隔离、ads 五维作用域浏览器隔离。浏览器用例网络全拦截为 fixture，不是业务数据验收；报表查询为内存 fixture，不是 Prisma 真实数据库集成。
- 本轮改动文件 ESLint 通过。
- `npm run typecheck` 在中间快照曾通过；最终复查被并行变化的非本轮文件 `src/components/agents/listing-agent-workbench.tsx:357-619` JSX 语法错误阻断（此前一次为 `src/components/operations/ext/reviews-workbench.tsx:164-165`）。此前亦观察到其他工作台临时语法错误，未覆盖其改动；**不宣称最终全项目类型检查通过**。
- 未重新构建、重启、部署或重跑生产浏览器 59 路由/30 分钟测试：共享源树正在并行变化，且本次不加载真实配置或连接真实服务。待源树稳定且类型检查通过后，按已有流程执行生产构建和浏览器复测。
- 目录 `/Users/chenjieliang/WorkBuddy/2026-11-14-21-24-28/woker` 无 `.git`，无法提供 Git diff 或已提交状态；未 commit/push/部署。

### 7.4 下一阶段验收清单

- 源树稳定后重新执行全量类型检查和生产构建；先校验构建身份/静态资源再采性能。
- 在批准的隔离数据库中建立两个真实 Workspace、两个 Seller，复测权限撤销、冲突输入、报表账号隔离及草稿切换；不直接在现有业务库建测试数据。
- 云端数据库/弱网与冷路由离群值仍待专门测量；历史内存数据不作为本次修改后性能背书。
- 无授权 403 和 raw fetch 去重继续遵循“无实际收益证据不改”；已发送的旧作用域业务请求不能在客户端撤回，服务端权限、审计与幂等边界仍负责执行。

## 八、UI 稳定化与生产模式复测（2026-11-15 夜间续）

- 直接修复 `tasks/task-center-workbench.tsx`、`versions/version-history-workbench.tsx` 的 `table` prop 缺失闭合花括号；不覆盖其他并行模板改造。
- 共享源全项目 `npm run typecheck` 在本轮最新完整检查通过；`npm run test` 为 1871/1871，通过；完整 lint 为 0 errors、11 warnings；`ui:guard` 通过，未更新基线掩盖问题。
- 完整生产源码快照 `production-build-snapshot` 未裁剪路由，未跳过 lint/type：编译、类型检查及204/204静态生成通过，standalone产物存在；BUILD_ID `CSLKX4VnihkDwwqxF-PZO`。环境无 `.env`、无真实业务凭据，未修改字体/layout。
- Ads 两组浏览器回归 62/62 通过（组件与模拟API，不冒充真实Ads授权）。
- 既有 production-mode 一次性 PostgreSQL 导航测试通过：登录中位数34.79ms/P95 39.36ms，三页热导航中位数54.78ms/P95 71.16ms；shell持久化、即时撤权、跨组织身份、停用账号通过。此脚本是裁剪路由并跳过构建类型检查的性能入口，不能代替上一条完整构建。
- 完整构建独立服务 + 新建带label PostgreSQL 的真实后端/浏览器E2E：26/26断言通过。真实fixture双工作区下拉切换验证A/B草稿互不污染且切回恢复；Ads campaigns/accounts/reports硬加载及切换带正确scope、保持无授权空态；body/query/header/context与其他组织冲突均403；停用账号401；无500及pageerror。服务已停止，一次性数据库已核对label后清理。
- 结果文件位于会话目录 `/Users/chenjieliang/WorkBuddy/2026-11-15-21-52-36/`：`production-navigation.json`、`isolated-workspace-e2e-result.json`、`isolated-workspace-e2e.mjs`、`production-build-snapshot/build-result.json` 及构建日志。
- 共享源码仍有其他任务并行变化；完整构建结果仅绑定已记录SHA256清单的快照，不自动代表之后新增改动。未重启共享实例、未提交/推送/部署，仍非真实Amazon账号与生产验收。

### 8.1 最终构建与同构建端到端闭环

- 为纳入期间并行完成的源码变更，另建 `production-build-final`，不覆盖第一份快照。源码冻结于 2026-11-15 23:18:52（北京时间），最终 BUILD_ID 为 `ng0Pi7OBdTnPTN7PmV77Z`；完整 `npm run build` 成功，未裁剪路由、未跳过 lint/type，204/204 静态生成，standalone server 存在。构建期间快照文件无变化、无快照专用代码修补。
- 23:21:52 核对共享 src 与最终快照无漂移；冻结后更新的 `tests/browser/lili.spec.ts` 未纳入该次验证，不将其新版计入已验证范围。冻结清单与 SHA256 位于 `production-build-final/freeze-manifest.json`、`source.sha256`、`src.sha256`。
- 最终构建保留 10 条非阻断 ESLint warnings，以及 `/api/products` 的 runtime 重导出静态识别警告。未为消除无关警告扩大修改。
- 对上述最终 BUILD_ID 再次启动独立生产构建服务与一次性 PostgreSQL，26/26 断言通过，0 失败；`pageErrors` 为空、记录响应中无 500、无外部请求拦截记录。真实应用 API 与一次性数据库完成登录、工作区枚举、A/B 草稿恢复、工作区输入冲突拒绝、跨组织拒绝和停用账号即时拒绝。
- **Ads 验收边界补正**：原始响应显示 campaigns/accounts/reports 的业务读取在该无 Amazon 授权 fixture 下均返回 403。该部分证明硬加载/切换重新请求时携带正确工作区，以及拒绝访问时不显示数据；不能证明已授权 Ads 空数据读取成功，更不能证明非空广告数据切换隔离。非空数据与迟到响应的组件 fixture 回归属于另一验证层，不替代真实 Ads 后端数据验收。
- 最终结果为 `isolated-workspace-e2e-final-result.json`，记录 BUILD_ID 与上述最终构建一致，且 `cleanup.serverStopped=true`、`cleanup.databaseRemoved=true`。复现脚本 `isolated-workspace-e2e.mjs` 支持 `APP_PATH` 与 `OUTPUT_PREFIX`，保留第一份快照的原结果。
- 本轮完成的是本地隔离构建与端到端复测，不是部署或生产业务验收；未连接真实 Amazon/业务数据库，未重新执行全 59 路由审计或 30 分钟挂机，云端数据库与弱网仍未覆盖。

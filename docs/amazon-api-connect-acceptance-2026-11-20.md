# Amazon SP-API / Ads API 接入验收报告（2026-11-20）

> 目标：用户希望在**系统 UI 内自行填入并管理** SP-API 与 Ads 凭据，且在真正填入前先完成一次端到端验收，确认"连通、触发、承接页、字段拉回、合规"五项无忧。本报告为**只读审计**结论，未改动任何生产配置与代码。

## 0. 一句话结论

**可以按你方便的"UI 填入"方案做，且合规**（应用级凭据放服务端环境变量正是 Amazon 要求，不是违反规则）。但填入前必须由我在服务器上做**3 项前置配置**（云执行角色 + 加密密钥 + Ads 应用级 OAuth 配置），否则保存或执行会失败。填入后大部分数据页可见真实数据，**但有三类页面不会因 SP-API 凭据而变好**（详见 §5），需单独接数据源。

## 1. 报错根因（已确认）

`当前进程未配置云端执行角色` 来自 `src/lib/amazon/execution-role.ts:18-19`，唯一开关：

```ts
process.env.AMAZON_API_EXECUTION_ROLE === "cloud"
```

生产 123 服务器 `.env` 从未配置该变量，且缺 LWA 凭据——所有官方 Amazon 请求在 `assertAmazonCloudExecution()` 处 fail-closed 拦截。这是**安全闸门被正确触发**，不是代码 bug。

## 2. 凭据"双轨"机制（关键，决定你怎么填）

系统有两套凭据轨，务必分清：

| 轨道 | 包含字段 | 存哪 | 用途 | UI 能否管 |
|---|---|---|---|---|
| **A. 卖家授权轨**（主轨） | lwaClientId、lwaClientSecret、refreshToken、AWS keys | UI「店铺与授权→新增授权」经审批写入 `AmazonSpApiAuthorization.credentialsCiphertext`（AES-256-GCM 加密） | **实际所有 SP-API 数据调用**从这里解密取（`service.ts:111`、`processor.ts:203`） | ✅ 能，且这是你要的路径 |
| **B. OAuth 应用轨**（可选） | applicationId、clientId、clientSecret、redirectUri | **仅环境变量**，`appSettings()` 读取（`oauth.ts:16-24`） | 仅用于"点按钮自动跳转 Amazon 换取 refreshToken"的便利流程 | ❌ UI 无覆盖路径 |

**核心结论**：轨道 A 已经能存全套可用凭据。你可以**直接在 UI 填入 lwaClientId / lwaClientSecret / refreshToken 并保存，无需走 OAuth 流程**即可拉数。OAuth（轨道 B）只是一个"自动生成 refreshToken"的可选捷径，需要额外的服务端环境变量。

- 广告侧同理：UI 填入 Ads refresh token 存 `AmazonSpApiAuthorization` 对应 Ads 凭据（`AMAZON_ADS_ENCRYPTION_KEY` 加密），实际调用从这里取（`sync-processor.ts:80`）。Ads OAuth start/callback 同样只读环境变量（`authorization.ts:18-28`）。

## 3. 填入前必须完成的前置配置（我来在服务器做）

| # | 配置项 | 值 | 必要性 |
|---|---|---|---|
| 1 | `AMAZON_API_EXECUTION_ROLE` | `cloud` | 🔴 阻塞：不开则所有官方请求被拒 |
| 2 | `AMAZON_SP_API_ENCRYPTION_KEY` | 已存在（32B base64，勿动） | 🔴 已有：动了已存凭据不可解密 |
| 3 | `AMAZON_ADS_ENCRYPTION_KEY` | 需确认/生成 32B base64 | 🔴 Ads 凭据保存需要 |
| 4 | `QUEUE_DRIVER` | `redis`（已是） | 已有 |
| 5 | worker 进程 | 6 个 systemd 服务 active（已是） | 已有 |

> 若你走**纯 UI 填入轨道 A**（不用 OAuth 按钮），前置只需 #1 + #3；`AMAZON_API_EXECUTION_ROLE=cloud` 是唯一必须新增的变量。

## 4. 填入后同步是否自动触发（验收通过 ✅）

- 授权保存成功 → `ensureAmazonSyncInitialized`（`oauth.ts:120`）→ 自动建数据源、建 `auto-v1:` 计划（`nextRunAt=now`）、入队（`scheduler.ts:36-62`）。
- `amazon-sync-worker` 每 **30s** tick 兜底重扫（`amazon-sync-worker.ts:102-105`），即使授权瞬间初始化失败也会补上。
- 全部 gate：`AMAZON_API_EXECUTION_ROLE=cloud` + `QUEUE_DRIVER=redis` + worker 存活 + scope 未被 `AMAZON_SYNC_CENTER_SCOPES` 排除 + 相关域角色已 attested。
- **结论**：不存在"授权了但同步永久不触发"的硬缺口。前提齐备后自动建计划并拉数。

## 5. 各数据页填入后可见性（诚实清单）

| 数据域 | 拉回能力 | 承接页 | 填入 SP-API 后可见？ |
|---|---|---|---|
| 订单 / 库存 / Catalog / 财务 / 退货 / 结算 / 赔偿 / 库龄 / 库存事件 / 履约 / Listing / 定价 / BuyBox / 销售流量 / 品牌分析 | ✅ 有真实适配器 | ✅ operations 各 workbench | ✅ 可见（以 Amazon 账号实际授权角色为前提） |
| Ads 9 个结构域 + 5 类报表 | ✅ 已实现 | ✅「已同步广告数据」 | ✅ 可见（报表需 Profile 报表权限；未做真实账号验收） |
| `order_items` | ⚠️ `implemented:false`，走订单详情派生 | 有页 | ⚠️ 可能空 |
| 15 个 report 域（FBA 发货/客户销售/移除单/仓储费/长期仓储费/费用预览等）+ promotions + notifications | ✅ 落库 | ❌ 无前端 tab，仅 MCP 数据集可查 | ⚠️ 数据会落库但页面看不到 |
| `/sellfox/*`（销量统计、在线产品、库存、广告报表等赛狐页） | ❌ 由 **Sellfox API 采集**填充，SP-API 不写这些表 | 有页 | ❌ **仍会空**，必须另配 Sellfox clientId/clientSecret 并跑 Sellfox 同步 |
| Sellfox AWD 库存 / 业务员 / 业绩归属人等字段 | 标记 `kind:missing`，不造数 | 有占位 | ❌ 数据源本身不提供，保持缺失 |

**这正对应你的第 2 点担忧**：SP-API 与赛狐是两套独立数据源。只填 SP-API，`/sellfox/*` 不会好；要赛狐页出数，需单独接 Sellfox 数据源。

## 6. 亚马逊规则合规性（验收：稳健 ✅）

- 限流退避：client 层识别 429/5xx + `Retry-After`，worker 层令牌桶 + 自适应速率 + 指数退避抖动（`orders-rate-limit.ts`、`processor.ts:291-319`）。
- 上限控制：报表回溯硬上限 31 天、订单分页 100、ASIN 批量≤20、响应体 4/16MB、Ads 查询预算 60/min。
- 授权边界：一组凭据绑一个 Seller ID（`seller-bindings.ts:14`）、org/workspace 双维过滤、同步前 frozenScope 校验 seller 未变；凭据 AES 加密 + AAD 绑定，日志/错误脱敏，无 secret 下发前端。
- Ads 报表：create→poll→download 状态机，轮询间隔≥60s，写操作恒 NOT_IMPLEMENTED（无越权写入）。
- **合规结论：当前代码无违反 Amazon 规则的模式。** 应用级凭据（clientId/secret/appId/redirectUri）放服务端环境变量，正是 Amazon 对应用注册信息的安全要求——**按此方案做不违反规则**。

## 7. 填入前必须处理的缺口（诚实标注）

1. 🔴 **Ads 全域未做真实账号验收**（`capabilities.ts:99`）：代码已实现，但没有在真实卖家账号验证过 Profile 报表权限与采集正确性。首次填入后需人工核对数据。
2. 🔴 **查询预算仅进程内**（`query-budget.ts`）：单实例部署无碍；若将来多实例，需部署级限流器兜底。
3. 🟡 **15+2 个 SP-API 域只落库无页面**：数据拉回了但前端看不到（只能经 MCP 查询）。若你要求"每个字段都有承接页"，这些域需要补前端页面。

## 8. 建议执行顺序（等你确认）

1. 我先在服务器做前置配置（role=cloud + 确认 Ads 加密密钥），逐个重启服务，用生产复现脚本确认配置页不再报 409。
2. 你在 UI「店铺与授权」填入 SP-API 凭据（lwaClientId/secret/refreshToken），走审批保存。
3. 我核对授权是否自动建计划、worker 是否开始拉数、operations 页是否出数。
4. Ads 同流程；首次拉数后人工核对报表权限与数据正确性。
5. 赛狐页若也要出数，单独接 Sellfox 数据源（另立需求）。

> 状态：**验收完成，等待你确认执行顺序**。生产配置未改动，代码未改动。

---

## 9. 承接页补齐完善（2026-11-20 第二轮，已落地代码）

> 用户追加要求：**赛狐数据与 Amazon 完全隔离独立**；在此基础上补齐"没有承接页的字段"对应的承接页。本节记录已完成的**代码改动**（未改动生产配置、未写入任何真实凭据、未重启服务）。

### 9.1 本次做了什么

§7.3 点名的"15 + 2 个只落库无页面"数据域，此前数据能落库、只读 API（`/api/operations/sync-center`）与 MCP 数据集都已就绪，**唯一缺口是前端 view 注册与组件分发**。本次把这个缺口补齐：

- **新增「报告与观察中心」板块**（`operations-sections.tsx`，E 组），一次性注册 17 个承接页 view。
- **15 个 report 域**（`fba_customer_sales`/`mfn_returns`/`fba_shipments`/`fba_inventory_by_country`/`fba_fulfilled_inventory`/`fba_inventory_report`/`reserved_inventory`/`stranded_inventory`/`recommended_removals`/`storage_fees`/`long_term_storage_fees`/`fba_overage_fees`/`fee_preview`/`removal_order_report`/`removal_shipment_report`）→ 复用 `DomainReportsWorkbench`，与既有 `settlements`/`reimbursements`/`inventory_age`/`inventory_events` 同一分发数组。
- **promotions / notifications** → 复用 `ObservationsWorkbench`，补齐了这两类域的 `kinds`、列渲染（`cells`/`titles`）与语义说明（促销为卖家＋站点级观察；通知仅为订阅发现、不代表事件已接收）。
- **架构账本同步**（`domain-architecture.ts`）：17 个域的 `landing` 从"仅同步矩阵"升级为 `workbench`，`spReaderOnlyNote` 清空，账本与实际分发一致。
- **新增守卫测试**：架构测试断言 17 个域都有 workbench 路由；导航测试断言 17 个 view 都在 `operationsEntries` 且非 pending、报告中心板块挂在 E 组。

### 9.2 赛狐与 Amazon 隔离（本次重点确认，未被触碰）

经只读审计 + 测试确认，两套数据源在应用层已是**稳固隔离**，本次改动全部只读 `Amazon*` 表与 Amazon 数据源，未新增任何跨源读取：

| 隔离层 | 现状 | 证据 |
|---|---|---|
| 传输 / 端点 / 工具 / 数据集白名单 | fail-closed，跨源一律 401/403 | `src/lib/mcp/isolation.ts` |
| 表前缀 | `Amazon*` 与 `Sellfox*` 互斥，无共用表、无跨域写 | `prisma/schema.prisma` + grep |
| 承接页数据链 | 新增 17 页全走 `/api/operations/sync-center` → `Amazon*` 表 | `domain-reports-query.ts:14`、`observations-query.ts` |
| 隔离守卫测试 | 30/30 通过 | `mcp-isolation*.test` |

> 说明：`SellfoxStore.sellerAccountId` 保存 Amazon Seller ID 仅用于站点对齐（合法引用，非混写）。数据库物理双只读角色（`amazon_mcp_ro`/`sellfox_mcp_ro`）仍未由 DBA 在真实库授权，属外部阻塞，不影响本次承接页逻辑。

### 9.3 验证结果

| 项 | 结果 |
|---|---|
| `amazon-domain-architecture.test.ts` + `sync-center-navigation.test.ts` | 14/14 通过 |
| MCP 隔离测试（3 个文件） | 30/30 通过 |
| `npm run typecheck` | 通过 |
| ESLint（5 个改动文件） | 无错误 |
| Next.js 生产构建 | 进行中（见本次交付说明） |

### 9.4 诚实边界

- **有页面 ≠ 有数据**：承接页解决的是"能看到、字段能承接"，真实数据仍需你在 UI 填入 SP-API 凭据并完成授权同步后出现；空时页面显示空状态/未发布说明，不造数。
- **promotions 读取需显式 Seller + Marketplace**（`observations-query.ts:14` 的既有安全约束）：进入该页后请先用页面顶部店铺/站点筛选选定范围，否则读取器会拒绝（这是安全边界，非缺陷）。
- **赛狐侧 planned 字段**（SPU/本地仓/库存流水/应收/发票等 16 个数据集）属于**数据源缺口**（目标表尚未在 Prisma 建表、无同步器），不是承接页缺口；它们已有占位承接页显示"尚未同步"。按"缺失数据不补造零值"红线，本次不新建空壳表、不伪造数据。若需要真实出数，需另立 Sellfox 数据源接入需求。
- **生产配置仍未改动**：`AMAZON_API_EXECUTION_ROLE=cloud` 等前置配置、真实凭据、服务重启均未在本次执行，等待你按 §8 顺序确认后再做。

## 10. 承接页连通性补齐（2026-11-20 第二轮完善）

### 10.1 缺口

第 9 章补齐的 17 个承接页（15 个 report 域 + promotions/notifications）虽已注册到 `operationsEntries`，可通过 `/operations?view=<id>` 访问，但**没有 `/amazon/<slug>` 直达别名，也不在"亚马逊数据"一级板块二级菜单**——即"有页面但从主导航点不到"，未满足"不会有页面没有连通"的验收要求。

### 10.2 改动

- `src/lib/amazon/amazon-slug-routes.ts`：新增 17 条 `<slug> → view:<id>` 后缀映射，`amazonSlugRewrites()` 自动生成 `/amazon/<slug> → /operations?view=<id>` rewrite。
- `src/components/app-shell/business-navigation.ts`："亚马逊数据"一级板块新增"报告与观察中心"分组，17 个二级入口，全部 `moduleId: operations`，与赛狐 `/sellfox/*` 对称。
- `tests/navigation-7-sections.test.ts`：新增两条守卫，锁死这 17 个 slug 的一级导航入口与 rewrite 解析，防止回归。

> 全部为导航与路由注册改动，未新增数据源、未改表、未触碰赛狐数据；数据隔离边界不变。

### 10.3 验证

| 项 | 结果 |
|---|---|
| `navigation-7-sections` + `amazon-domain-architecture` + `sync-center-navigation` | 33/33 通过 |
| `npm run typecheck` | 通过 |
| ESLint（3 个改动文件） | 无错误 |

## 11. 生产执行与验证（2026-11-20）

### 11.1 顺序

按用户指示：**先完善 → 推 GitHub → 再推服务器**。第 9、10 章的代码完善已全部推送 GitHub 并部署生产。

### 11.2 生产前置配置

| 项 | 执行前 | 执行后 | 说明 |
|---|---|---|---|
| `AMAZON_API_EXECUTION_ROLE` | 缺失（409 根因） | `cloud`（`.env` 第 37 行） | 先备份 `.env`（`.bak.20261120034023`），仅追加一行，权限 600 不变 |
| Ads/SP-API 加密密钥 `AMAZON_SP_API_ENCRYPTION_KEY` | 已存在 | 未改动 | 44 字符 Base64、valid32bytes=true；Ads 与 SP-API 共用此密钥，故"确认 Ads 密钥存在"已满足 |
| 服务重启 | — | 6 服务逐个重启并确认 active | 每个进程 `/proc/<pid>/environ` 均确认加载 `cloud` |

### 11.3 配置页 409 消除验证

新增只读脚本 `scripts/verify-amazon-cloud-execution.mts`：加载 `.env` 后**直接 import 真实代码** `assertAmazonCloudExecution()`，不发 Amazon 请求、不改数据。

- 反向对照（无 cloud）：`verdict=CLOUD_EXECUTION_MISSING`，抛出原 409 报错文案 → 证明脚本能捕获该错误。
- 生产环境（部署前 + 部署后各一次）：`verdict=CLOUD_EXECUTION_OK`、`assertThrew=false` → **409 已从代码路径消除**。

配套 HTTP 证据：`/api/health`=200；配置页 `/settings/amazon-connections`=307（跳登录，非 409/500）。

### 11.4 部署结果

| 项 | 结果 |
|---|---|
| 部署基线 | `base=1e264be`（生产原 commit）→ `head=fef74a6`；本轮 diff 11 文件，**无迁移、无锁文件变更、无需人工审核** |
| 全量单测 | 2567/2568 通过；唯一失败为 `production-readiness` 的**本地 Node 22.13.1 < 22.19 环境门禁**（服务器为 22.23.4，达标；与代码改动无关） |
| typecheck / ESLint / 生产构建 | 通过 / 无错误 / 编译成功 + 235 静态页 |
| 新 release | `20261119-200250-main-fef74a64ce...`，health=passed，runtimeReleaseVerified=true |
| 服务 | 6 服务全 active；迁移 skipped（本就无需）；rollback not_needed |
| 承接页连通性 | 17 个 `/amazon/<slug>` 全部返回 307（rewrite 生效、跳登录），异常数 0；新 release 源码确认 17 个 view 全部注册 |
| GitHub | 远端 main 线性推至 `54eb8f3`，tree 与本地一致；合入远端 7 提交后推送 |

### 11.5 仍待用户操作（未擅自执行）

- 在 UI 填入真实 SP-API / Ads 凭据并完成授权同步——按用户"验收完我再填入 api"的安排，凭据仍由用户在系统内自行管理。
- 数据库物理双只读角色 (`amazon_mcp_ro`/`sellfox_mcp_ro`) 仍待 DBA 在真实库授权（外部阻塞，不影响本轮）。

---

## 12. 补充说明（2026-11-20）：application_id 可选 + 文档随制品发布

### 12.1 背景与根因

- 生产配置时点「Amazon 授权」按钮报 **"Amazon application ID 缺失或超出长度限制"**。根因是 `oauth.ts:appSettings()` 用 `requiredText(AMAZON_SP_API_APPLICATION_ID, ...)` 强制校验该环境变量，缺失即抛错。
- 生产环境 `AMAZON_SP_API_APPLICATION_ID / LWA_CLIENT_ID / LWA_CLIENT_SECRET / OAUTH_REDIRECT_URI` **四项均缺失**，印证实际使用的是**轨道 A（直接填 refresh token）**，本就不走 OAuth consent 流程。
- 按 [Amazon 官方 onboarding 文档](https://developer-docs.amazon.com/sp-api/lang-zh_CN/docs/onboarding-step-6-set-up-the-authorization-workflow)：`application_id` 仅**公共应用**的网站授权 URL 必需；**私有应用自我授权不需要**。

### 12.2 改动（最小）

- `oauth.ts:appSettings()`：`application_id` 由必填改为可选；仅当环境变量非空时按原规则校验格式。
- 抽出纯函数 `buildConsentUrl(region, applicationId, redirectUri, state)`：仅当 `applicationId` 非空时在 consent URL 中带 `application_id` 参数；私有应用不带该参数也能正常授权跳转。
- 新增守卫测试（无 application_id / 有 application_id / 无效区域三种情形），不碰数据库。
- `package-ci-artifact.sh`：纳入 `docs/` 目录，验收报告等 238 个 md 随制品发布，便于服务器端查阅；原有 `-delete` 清理规则仍过滤 `.env`/日志，无敏感文件泄漏。

**数据真实性/隔离**：本轮只改 OAuth 应用级凭据的可选性与打包内容，未写入任何真实凭据、未改表、未触碰赛狐数据源，隔离边界不变。

### 12.3 验证与发布

| 项 | 结果 |
|---|---|
| 目标单测 `amazon-cloud-execution.test.ts` | 6/6（含新增 consent URL 3 场景守卫）|
| typecheck / ESLint | 通过 / 无错误 |
| 生产构建 | 编译成功 + 235 静态页 |
| GitHub | 远端 main `f53db0d`，tree `b4b4c58` 与本地一致 |
| 新 release | `20261119-210103-main-2623ecf...`，health=passed，6 服务全 active，无需迁移 |
| 服务器 docs | 238 个 md 已随制品落地，含本报告；无 `.env`/日志泄漏 |
| 生产真实代码验证 | 无 application_id 时 consent URL 正常构造（`has_application_id=false, has_state=true`）；带 application_id 时正确附带 |

### 12.4 仍待用户操作

- 真实 SP-API / Ads 凭据仍由你在系统 UI 内自行填入授权（轨道 A），本轮未写入任何凭据。
- 若日后改用公共应用 OAuth 自动化换取 refresh token（轨道 B），需在服务端补配 LWA 三件套 env（clientId/clientSecret/redirectUri）及可选 application_id。

---

## 13. 补充说明（2026-11-20）：重新启用已停用的 SP-API 授权

### 13.1 背景与根因

- 生产只读核查发现：唯一的 SP-API 授权记录状态为 `DISABLED`，且审批链中 `disable-authorization` 已应用。原先"验证参与站点""停用授权""更新凭据"按钮在 DISABLED 态被置灰，页面上没有"重新启用"入口，用户因此无法恢复该授权——这是**可用性缺口**，不是数据丢失或回归。
- 该状态是按既有审批流合法产生的，未发现越权或异常写入。

### 13.2 改动（对称 disable，最小）

- 新增 `enable-authorization` 操作，贯穿 operation 注册、字段白名单、审批预览/权限校验、apply 分发全链路；复用现有审批流（202 → 批准 → 应用）。
- service 层 `enableAuthorization`：`DISABLED → NOT_CONFIGURED` + revision+1 + 清空站点参与/验证时效 + 审计日志；带 scopeLock、`assertAmazonScopeAdmin`、`revision` 乐观锁与租户/工作区隔离，且 `where` 限定 `status: "DISABLED"` 防止重复/越态启用。
- 设计决策：恢复到"待验证"而非直接 CONFIGURED——停用时数据源/任务/站点参与信息已被停用或清空，必须重新验证授权才能按既有流程重建，不绕过 Amazon 站点核验。
- 前端两处（同步中心授权卡片、连接管理页）在 DISABLED 态显示"重新启用授权／连接"按钮，验证/停用/更新按钮不再渲染；非停用态保持原样。
- 数据真实性/隔离：只改授权状态机与按钮，未写真实凭据、未改表、未触碰赛狐数据。

### 13.3 验证

| 项 | 结果 |
|---|---|
| 授权审批单测 | 10/10（含"重新启用不可绕过审批"守卫 + requestChange 接受 enable）|
| typecheck / ESLint | 通过 / 无错误 |
| 生产构建 | 编译成功 + 235 静态页 |
| 生产真实状态 | 授权 1 条 DISABLED、审批 `disable-authorization` 已应用（只读核查，未改库）|

> 诚实说明：`tests/browser/sync-center.spec.ts` 的用例基于旧导航结构（查找"店铺与授权"按钮），而当前应用已重组为 7 大板块（"接入与授权"二级菜单），且该 spec 的 `next/navigation` fixture 缺少 `useRouter` 导出。该 E2E 套件在本环境属既有不可运行状态，与本次改动无关；本轮不以其作为验证门禁，核心状态机由可运行单测覆盖。

### 13.4 用户操作路径

- **恢复已停用授权**：店铺与授权 → 对已停用授权点"重新启用授权" → 变更审批中批准并应用 → 该授权回到待验证 → 点"验证参与站点" → 批准并应用 → 自动重建来源与计划。
- **新增一条授权**：店铺与授权 → 新增授权 → 填名称/区域/LWA Client ID/Client Secret/Refresh Token → 保存（生成审批请求）→ 变更审批批准并应用 → 验证参与站点 → 批准并应用。

---

## 14. 补充说明（2026-11-20）：变更审批入口与批准/应用内嵌到系统设置「集成」

### 14.1 背景与根因

- 用户反馈"审批页面／批准应用不见了"。核查确认：审批后端（`GET /api/operations/sync-center?section=approvals`、`POST .../approvals`）、运营中心的审批页渲染（`page === "approvals"`）、以及一级导航「变更审批」项**均完整存在，未删除**。
- 真实缺口是可用性：系统设置页「集成」页签里只有"打开数据处理中心"和赛狐凭据两个卡片，没有直达变更审批的入口。用户在设置页配置／停用／重新启用 Amazon 授权后生成审批请求，却在该页找不到批准／应用的地方，感觉"审批页面没有了"。

### 14.2 改动（最小，复用既有审批接口）

- 新增 `src/components/settings/amazon-approvals-panel.tsx`：在设置页「集成」页签内嵌完整变更审批面板，读取 `section=approvals`，支持批准／拒绝／撤销／应用四个动作，权限判断（`canApprove` / `canConfigure|canEdit|canCreate`）与运营中心审批页逐字一致，脱敏摘要、状态徽章、SHA-256 摘要展示口径相同。仅内嵌 UI，不新增后端、不改状态机、不改表。
- `settings/page.tsx`：「集成」页签内容由 `<AmazonSpApiSettingsPanel /><SellfoxCredentialsPanel />` 变为 `<AmazonSpApiSettingsPanel /><AmazonApprovalsPanel /><SellfoxCredentialsPanel />`。
- `amazon-sp-api-settings-panel.tsx`：新增"变更审批"按钮，指向 `/settings?tab=integrations#amazon-approvals`（页内锚点）；"打开数据处理中心"保持 `/operations?view=connections`。
- `settings-tabs.tsx`：`?tab=integrations` 识别 `#amazon-approvals` 锚点并滚动定位。
- 数据真实性/隔离：审批读写的租户／工作区 scope、操作权限、乐观锁与审计全部沿用现有接口；本轮未写真实凭据、未改业务数据、未触碰赛狐数据源，隔离边界不变。

### 14.3 验证

| 项 | 结果 |
|---|---|
| typecheck | 通过 |
| `amazon-sp-api-settings.spec.ts`（浏览器） | 2/2：①入口链接指向页内锚点且无多余 API 调用；②内嵌面板"读取→批准→应用"经现有接口，`decisions=["APPROVED","APPLY"]` |
| 审批后端 | 未改动，沿用 13.3 已验证的 10/10 单测 |

> 运营中心「变更审批」页保持不变，两个入口共用同一审批流；本次只是让设置页「集成」也能就地完成批准／应用。

---

## 15. 同步中心 500 兜底可观测性修复（2026-11-20）

### 15.1 现象与排查

- 用户反馈同步中心报「同步中心请求失败，请检查数据库、加密配置或 Amazon 授权。未返回内部错误或凭证。」——该文案唯一来源为 `src/app/api/operations/sync-center/route.ts` 的 `fail()` 500 兜底。
- 根因（可观测性缺陷）：`fail()` 对所有非受控异常（Prisma/DB、解密、基础设施）既不返回客户端（安全，正确），**也不落任何服务端日志**。项目其它 operations 路由的 catch-all 均记录脱敏日志，唯独此处静默吞异常，导致生产 500 无法定位。
- 生产只读排查（加载真实 `.env`，未写业务数据、未发 Amazon 请求）：
  - 加密配置正常：`AMAZON_SP_API_ENCRYPTION_KEY` 格式有效（44 字符 Base64／32 字节），现存的 SP-API 授权凭证可正常解密，`AMAZON_API_EXECUTION_ROLE=cloud`。
  - 数据库与权限数据正常：审计表、数据源、角色权限（17 角色）格式均合法；生产仅 1 个 active owner。
  - 全量复现所有 GET section（无授权用户、临时授权用户、真实报告 resource、并发 55 请求）均返回受控状态（200/400/403/409），**未复现 500**。日志侧仅见间歇性 `pg` 并发查询警告，无同步中心异常堆栈（因被吞）。
  - 结论：500 为间歇/特定条件触发的非受控异常；在补齐日志前无法据实定位具体异常，不做猜测性改动。

### 15.2 改动（最小，仅补可观测性）

- `src/app/api/operations/sync-center/route.ts`：新增导出纯函数 `logUnexpected(error)`，在 500 兜底前调用。仅记录**错误类型名、Prisma 错误码、Prisma meta 中的字段名**（字段名经正则白名单化）；**绝不记录** message、堆栈、SQL、参数、凭证或租户标识。返回给客户端的文案与状态码不变（继续保持"不返回内部错误或凭证"的安全承诺）。

### 15.3 验证

| 项 | 结果 |
|---|---|
| typecheck / ESLint | 通过、无警告 |
| `tests/sync-center-error-log.test.ts`（新增，3/3） | ①记录 name/Prisma code/字段名；②不泄露 message／凭证／堆栈；③畸形异常安全降级不抛错 |
| 全量单测 | 2584/2585；唯一失败为本地 Node 22.13.1 低于部署门禁 22.19（生产 22.23.4 达标），既有环境项 |

> 生产临时只读诊断脚本已全部清理，未遗留。后续若再现 500，可从 `journalctl -u amazon-web` 的 `[operations.sync-center]` 日志直接读到脱敏后的真实错误类型与 Prisma 错误码，据此精确定位根因。

## 16. 同步中心 500 真实错误码 P2039 与脱敏诊断增强（2026-11-20 续）

### 16.1 从生产日志抓到真实错误码

- 第 15 章的脱敏日志上线后（`b2f91e7`，生产 `amazon-web` 运行 commit 一致），在生产 `journalctl -u amazon-web` 抓到真实兜底异常：
  - `Nov 20 12:53:57 [operations.sync-center] { name: 'PrismaClientKnownRequestError', code: 'P2039' }`
  - `Nov 20 12:54:03 [operations.sync-center] { name: 'PrismaClientKnownRequestError', code: 'P2039' }`
  - 两条之前紧邻 `(node) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0`（pg 8.23 的同一 client 并发查询告警）。
- 依赖版本：`prisma/@prisma/client/@prisma/adapter-pg 7.10.0` + `pg 8.23.0`。P2039 是 Prisma 7.10（prisma/prisma#29512）新引入的「**未被单独映射的底层数据库驱动错误**」兜底码：当驱动错误 kind 为 `postgres` 但不在 P1000–P2037 映射表内时，Prisma 统一抛 P2039，真实 SQLSTATE 藏在 `meta.driverAdapterError.cause.originalCode`。
- 因此 P2039 只是外壳，**根因必须看 SQLSTATE**（如 40001 序列化冲突、25P02 事务已中止、08P01 协议错误等）才能对症修复，不做猜测性改动。

### 16.2 离线复现结论（未写业务数据）

- 生产只读探查：全库仅 1 个 active owner、`AmazonDataAccessGrant` 与 `AmazonRoleDataAccessGrant` 均为 0 行；因此所有数据 section 在 `amazonDataAccess` 处返回受控 `AMAZON_SCOPE_EMPTY`（403），管理类 section（connections/settings/approvals/plans/sources）逐项直查均 200。**当前 DB 状态下离线遍历全部 section 均不复现 P2039**，说明 12:53–12:54 触发时段的数据/授权/并发状态与当前不同。
- 独立脚本（新建 PrismaClient）并发压测 overview trend 原生查询、事务内 `Promise.all` 多查询、管理类 section 并发（25 轮 × 双并发）均未触发 P2039 或 pg 并发告警；P2039 仅在运行中的 Next.js 进程（共享 prisma 单例、处理真实并发 HTTP 请求）里出现，依赖真实会话与并发时序，离线不可复现。
- 代码侧排查：确认存在 `$transaction(async tx => Promise.all([tx.*, tx.*]))` 模式（finance/orders/returns/field-coverage 等），事务在 adapter-pg 下独占单个 pg client，并发查询会在该 client 的 `_queryQueue` 堆积并触发 pg 告警——是 P2039 的可疑诱因之一；但当前权限状态下这些 section 走不到，**无证据指向具体哪一 section，故不在无据情况下批量串行化**。

### 16.3 本轮改动（最小，仍仅补可观测性）

- `src/lib/amazon-sync/log-unexpected.ts`：`logUnexpectedSyncCenterError(error, section?)` 在原有 name/code/字段名之外，新增记录 **SQLSTATE**（`meta.driverAdapterError.cause.originalCode`，正则白名单 `^[0-9A-Z]{5}$`）、**驱动类型**（`cause.kind`）与**触发 section/action**；三项均经严格白名单，**绝不记录** `originalMessage`、SQL、参数、凭证、租户标识或堆栈。
- `src/app/api/operations/sync-center/route.ts`：`fail(error, section?)` 透传 section；GET 从 `?section=` 传入、POST 从 `action` 传入；返回客户端的文案与状态码不变。
- 目的：下一次生产触发时，`[operations.sync-center]` 日志将直接给出 section + SQLSTATE + 驱动类型，据此可做**有据的精准修复**（而非猜测）。

### 16.4 验证

| 项 | 结果 |
|---|---|
| typecheck（Node 22.23.4） | 通过 |
| ESLint（Node 22.23.4） | 0 error（6 既有 warning，非本次改动） |
| `tests/sync-center-error-log.test.ts` | 5/5：原 3 项 + 新增 P2039 SQLSTATE/driver/section 记录、不泄露 originalMessage、畸形 driverAdapterError 安全降级 |
| 全量单测（Node 22.23.4） | 2625/2625 全部通过 |
| build / package-ci-artifact / release-check | 全部通过 |

> 待部署后由真实请求复现一次，读取 `[operations.sync-center]` 的 SQLSTATE → 精准修复真正根因。临时只读诊断脚本已全部清理。

## 17. 同步中心 500 根因确定与修复：enable-authorization 约束缺失（2026-11-20 续）

### 17.1 拿到真实 SQLSTATE，根因确定

- 部署第 16 章的增强日志后，用户于 13:48:25 复现，日志直接给出：
  ```
  [operations.sync-center] { name: 'PrismaClientKnownRequestError', code: 'P2039', sqlstate: '23514', driver: 'postgres' }
  ```
- **SQLSTATE 23514 = `check_violation`（CHECK 约束违反）**。这推翻了第 16 章「底层驱动并发错误」的猜测：pg 的 `already executing a query` 告警是同进程独立噪声，非根因。
- 证据链（100% 确定）：
  1. 用户点击「重新启用授权」（`sync-center-workbench.tsx` / `amazon-connections.tsx`）→ POST `{action:"enable-authorization"}`；
  2. `change-approval.ts:340` 创建审批请求时写入 `operation: "enable-authorization"`；
  3. 代码权威白名单 `approval-policy.ts` 的 `operationTypes` 共 12 项，**含** `enable-authorization`；
  4. 但生产库约束 `AmazonDataCenterChangeRequest_operation_check` 只有 11 项，**缺** `enable-authorization`（生产实测 `pg_constraint.pg_get_constraintdef` 确认，也缺 `adopt-identity/recover-finance-window/recover-report` 之外的 update，最新定义停在 `20261106060000`）；
  5. INSERT 违反 CHECK → PostgreSQL 23514 → Prisma 包装为 P2039 → `fail()` 500 兜底文案。
- 单测此前未拦截的原因：`amazon-authorization-approval.test.ts` 的 mock `changeRequest.create` 直接返回对象，绕过真实数据库 CHECK 约束。

### 17.2 修复（最小，针对根因）

- 新增 migration `prisma/migrations/20261227000000_amazon_change_request_enable_operation/migration.sql`：DROP 并重建 `AmazonDataCenterChangeRequest_operation_check`，使其与代码 `operationTypes` 的 12 项完全一致（补齐 `enable-authorization`）。
- 生产已应用全部 201 个既有 migration（与本地一致），故 `migrate deploy` 只会应用这 1 个新 migration，无积压风险；部署由 `server-artifact-release.sh` 依据 `requiresMigration=true` 用独立 `MIGRATION_DATABASE_URL` 执行。
- 新增防回归单测 `tests/amazon-change-operation-constraint.test.ts`（PGlite 离线 DDL）：① 解析代码 `operationTypes` 断言含 `enable-authorization`；② 用旧约束重现 INSERT 23514 失败；③ 逐字应用新 migration 后所有代码 operation 均可 INSERT；④ 未知 operation 仍被拒。杜绝代码白名单与数据库约束再次漂移。

### 17.3 验证

| 项 | 结果 |
|---|---|
| 新增 migration 一致性测试 | 1/1（重现旧约束失败 + 修复后全通过） |
| 相关单测（约束/授权/日志） | 10/10 |
| typecheck / lint（Node 22.23.4） | 通过 / 0 error |
| 全量单测（Node 22.23.4） | 2626/2626 全部通过 |
| build / package / release-check | 全部通过 |
| 部署 `migrate deploy` | passed（约束 20261227000000 已应用） |
| 生产端到端 INSERT `enable-authorization` | ok（真实 scope+owner 插入成功并清理），已越过原 23514 关卡 |

### 17.4 交付与一致性

- 本地 = GitHub main = 生产 = `8d3d245`（含并行合并的赛狐维度分析页 `82ae8c8`）。
- 6 服务全部 active，`aoocy.com/api/health` 200，`runtimeReleaseVerified: true`，`migration: passed`。
- 生产库约束 `AmazonDataCenterChangeRequest_operation_check` 已确认含 `enable-authorization`；用真实 scope 与 owner 身份 INSERT 该 operation 成功（随后清理，未污染数据）。
- 用户再次点击「重新启用授权」应返回 **202 审批请求**（不再 500 兜底），经批准并应用后授权恢复为待验证态。临时诊断脚本已全部清理。


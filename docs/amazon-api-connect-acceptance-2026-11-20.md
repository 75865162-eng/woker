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

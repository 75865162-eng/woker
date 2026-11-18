# MCP 配置与能力现况说明（2026-11-18）

## 1. 本说明的基线与结论

- 审计日期：2026-11-18，Asia/Shanghai。
- 本地分支：`codex/merge-remote-tiaotiao-erp`。
- 本地 HEAD：`243b5264b1234cd3c41d0c8e4169ca6cbfd9f6a8`。
- 对照版本：`17f3c6366ec8259dbaf6bf5e0352e3c1659efea7`。本轮核对的 `src/lib/sellfox`、`src/lib/amazon-sync`、`src/lib/amazon-ads`、`src/lib/lili`、`src/lib/mcp`、双 MCP 入口及 MCP 设置主面板，相对本地 HEAD 没有差异。因此以下核心实现结论同样适用于该版本；不据此声称两个版本所有文件相同。
- `883afa4fb5bfb66b859550dfc8a01ff0519f3f4b` 不含这里的双 MCP 核心入口和实现，不适用本说明中的“已实现”判断。
- 本轮只读检查源码、迁移和测试，并新增本说明；没有读取真实 `.env` 内容、客户端密钥或数据库业务数据，没有访问真实 Amazon / 赛狐 API，没有启动任务、实施迁移、修改 ACL、重启、提交、推送或部署。

**总判断：已有完整形态的配置页面、凭证生命周期、双 MCP 入口和本地数据库读取路径，但尚不能认定“凭证填好即全量采集、页面全部承接、两侧 MCP 全量可读、生产隔离已验收”全部完成。**

| 用户目标 | 当前代码判断 | 关键限制 |
|---|---|---|
| 赛狐 API 凭证录入、源数据同步到赛狐承接页 | 已有凭证保存、执行器、队列、分片和承接查询；覆盖部分业务域 | 14 个内置资源；通用端点须登记启用；7 个承接页面定义的 37 个数据集中，9 个已接入、28 个待接入；该统计不包含其他既有赛狐页面，也不等于真实库行数 |
| Ads API + SP-API 凭证接入、Amazon 全量采集承接 | 部分实现 | SP-API 有手动凭证与 OAuth；Ads 用服务端应用配置 + OAuth；SB/SD 业务读取未实现，SP 也有未实现域及历史保留限制 |
| 两侧数据独立隔离 | 有应用隔离及数据库 ACL 实施/审计工具 | “双池”主要是独立数据域、表清单及只读连接/角色，不证明物理数据库分离；真实 ACL 尚未在本轮核验 |
| 赛狐 MCP 读取承接页全部本地数据 | 不满足 | 摘要列不完整、原始 payload 不可读、多组 SQL 列名引号错误、页面与 MCP 查询不统一 |
| Amazon MCP 读取承接池全部本地数据 | 大部分基础能力存在，仍不满足完整验收 | 部分声明参数被入口拒绝；租户级表的全店铺授权通路不可达；部分读路径使用主 Prisma；分页完整性与实际数据库角色未验证 |

“全部数据”应明确为：授权范围内、已落地的业务数据、全部应披露业务字段和可遍历记录；不包含密码、令牌、密文及无租户隔离的数据。安全排除合理，但不能用排除敏感数据解释普通业务字段缺失。

## 2. 三类 MCP 与两种方向

### 2.1 ERP 对外提供

| 服务 | 地址 | 鉴权 | 职责 |
|---|---|---|---|
| Amazon MCP | `/api/mcp/amazon` | 数据库个人 `amcp_` Bearer | ERP 内的 Amazon 业务数据、结构化事实、归档与原始落地行；目录还含非只读工具，须逐项受控 |
| 赛狐 MCP | `/api/mcp/sellfox` | 数据库个人 `sfmcp_` Bearer | ERP 内赛狐数据查询、补货建议、趋势和广告诊断 |
| Lili MCP | `/api/lili/mcp` | 公共定义可匿名；业务数据需个人 Bearer / Lili OAuth | Skills、研究和 ERP 工具编排；不是另一个赛狐全量读取服务器 |

### 2.2 ERP 主动调用外部

- SellerSprite / 卖家精灵 MCP：外部市场、关键词、ASIN 研究。
- 西柚 MCP：外部研究，固定 MCP 地址 `https://mcp.xydc.com/mcp`。
- 当前 Lili runtime 的提供方是 `erp`、`sellersprite`、`xiyou`；工具聚合名采用 `erp__...`、`sellersprite__...`、`xiyou__...`。
- 当前该 runtime 没有独立 `sellfox` provider；不能因为 Lili 已连接，就认为赛狐 MCP 自动接入。
- 外部研究可能发出真实外部请求；“Amazon/赛狐本地数据读取不调用上游 API”的判断不能扩展成“Lili 所有工具都不联网”。

## 3. 页面和服务端入口

| 用途 | 页面 / 接口 | 当前行为 |
|---|---|---|
| 双 MCP 配置主面板 | `/settings?tab=mcp` | 地址、工具、凭证、范围、有效期、轮换、禁用、撤销、配置示例及最近事件 |
| Amazon MCP 专项管理 | 同步中心“同步设置”中的 `AmazonMcpPanel` | 个人凭证、范围、同步/Ads 状态、调用记录 |
| Amazon 凭证管理 API | `GET/POST /api/operations/amazon-mcp` | 登录和工作区检查后，调用 Amazon 凭证及状态服务 |
| 双 MCP 状态/赛狐凭证 API | `GET/POST /api/operations/mcp-isolation` | GET 汇总两侧状态并执行实际只读角色审计；POST 管理赛狐凭证或探针 |
| 赛狐源 API 凭证 | `/settings?tab=integrations#sellfox-credentials` | 与 MCP 访问令牌分开，录入 clientId/clientSecret |
| 赛狐源凭证 API | `/api/integrations/sellfox/credentials` | GET 状态，PUT 保存，revision 防并发覆盖 |
| 赛狐凭证测试 | `/api/integrations/sellfox/credentials/test` | 测试操作不等于已经完成全量同步；本轮未调用 |
| SP-API 源授权 | Amazon 数据处理中心“店铺与授权” | 新增/更新 LWA 凭证、申请审批、批准并应用，再验证身份/站点 |
| 旧 SP-API 保存 API | `/api/integrations/amazon/sp-api/credentials` | 已退役，返回 410，不能再用作保存入口 |
| Ads 源授权 | 广告账户与授权页面 | 选择区域，连接 Amazon Ads OAuth、发现 Profile、绑定 ERP 店铺 |
| Lili 设备 | 设置中的 Lili 设备面板，`/api/lili/pair`、`/api/lili/devices` | 创建配对、交换设备凭证、列出/撤销设备 |
| 外部研究工具 | 设置中的 SellerSprite 面板；Lili tool-config 西柚配置 | 独立保存外部 MCP 连接信息 |

状态页面中一些“ok”是按代码策略直接填入的描述，不是每次进行了端到端攻击测试；数据库角色项则使用真实 DSN 审计。页面展示“地址、前缀隔离正常”不证明实际数据查询成功。

`mcp-isolation` 状态接口当前用 `sellfox:view` 作为 GET 入口权限，Amazon 部分异常会捕获为空列表。这可能导致仅有 Amazon 权限的用户无法使用统一面板，或 Amazon 查询失败被表现为没有凭证；可回到 Amazon 专项接口核对。

界面和状态返回仍宣称旧 `/api/mcp` 是赛狐别名。本轮未在当前源码发现该路径的直接 Route Handler 或 Next rewrite；应使用 `/api/mcp/sellfox`，别名可用性不能只依据 UI 文案。

## 4. 配置分层：哪些值放哪里

### 4.1 运行配置

本地 web、API、CLI、注册 Worker 的常规配置源是根 `.env`；生产沿既有发布与 EnvironmentFile 流程注入。不能用历史临时 profile 或退役 dotenv 文件启动。

| 配置名 | 用途 | 是否等于业务已就绪 |
|---|---|---|
| `DATABASE_URL` | ERP 业务库，凭证、授权、审计及部分业务查询 | 否，只证明有配置仍不证明可连或已迁移 |
| `AUTH_SECRET` | ERP 身份/会话基础配置 | 否 |
| `REDIS_URL`、`QUEUE_DRIVER=redis` | 同步队列/调度 | 纯本地读取不以同步 Worker 在线为前提；新增采集需要真实可消费队列 |
| `MCP_PG_READONLY_URL` | 赛狐 MCP 独立 PG 连接 | 缺少时拒绝查询，不回退主库连接 |
| `AMAZON_MCP_PG_READONLY_URL` | Amazon 原始行工具独立 PG 连接 | 缺少时原始行工具返回服务未就绪；不代表所有 Amazon 结构化工具均使用该连接 |
| `SELLFOX_CREDENTIAL_ENCRYPTION_KEY` | 赛狐源 API 凭证加密，32 字节 Base64 | Web 和赛狐 Worker 必须一致并持久保留 |
| `AMAZON_SP_API_ENCRYPTION_KEY` | SP-API/审批封存等；西柚配置也复用相关封存能力 | 缺少或更换会使相应历史密文不可用 |
| `AMAZON_ADS_LWA_CLIENT_ID`、`AMAZON_ADS_LWA_CLIENT_SECRET` | Ads 应用级配置 | 当前通过服务端配置读取，不是设置页逐工作区手填应用凭证 |
| `AMAZON_ADS_OAUTH_REDIRECT_URI` | Ads 注册 callback | 路径为 `/api/integrations/amazon/ads/oauth/callback`；须与注册匹配 |
| `AMAZON_ADS_ENCRYPTION_KEY` | Ads refresh token / 检查点加密，32 字节 Base64 | 不应因部署重新生成 |
| `AMAZON_API_EXECUTION_ROLE` | `cloud` 才允许官方 Amazon OAuth/API/下载；其他/缺失按 local 拒绝 | local 可查落地数据，不代表可本机采集 |
| `AMAZON_ADS_SYNC_ENABLED` | Ads 同步暂停/启用策略 | 不会补出未实现适配器 |
| `AMAZON_ADS_SYNC_SCOPES` | Ads 精确租户限制 | 不替代 Profile 绑定和授权 |
| `AMAZON_ADS_REPORTING_MODE` | SP 报表采集模式；支持 off 停止新报表任务 | 不改变已发布事实的查询存在性 |
| `AMAZON_ADS_REPORT_DOWNLOAD_HOSTS` | 报表下载额外主机白名单 | 不应扩大为任意 URL |
| `AMAZON_ADS_ENTITY_HISTORY_ENABLED` | 已成功采集结构的观察变化历史 | 不等于拉到 Amazon 完整历史 |
| `LILI_PUBLIC_ORIGIN` | Lili OAuth 规范 HTTPS issuer/origin | 非 loopback 场景必须明确，不能信任任意 Host/Forwarded |

本轮没有检查上述真实值是否配置、两条只读连接指向哪个实际数据库、或 Web/Worker 是否加载一致。以上是代码配置合同，不是真实环境配置清单。

### 4.2 数据库业务配置

- 赛狐源 API：`SellfoxIntegrationCredential`，按组织+工作区唯一，加密保存 clientId/clientSecret，revision 防覆盖，API 不回显密文或明文。
- SP-API：`AmazonSpApiAuthorization` 等现有授权记录，按审批流程保存，独立核验卖家与站点身份。
- Ads：`AmazonAdsAuthorization` 保存 OAuth 获得的 refresh token 密文，`AmazonAdsProfile` 保存账户发现及绑定。
- Amazon MCP：`AmazonMcpCredential` 保存用户、组织、工作区、状态、tools/scopes、到期日、revision、tokenHash、可识别前缀等。
- 赛狐 MCP：`SellfoxMcpCredential` 保存上述身份信息及 storeIds、工具范围、到期、hash 等。
- 外部工具：`ExternalIntegrationSetting` 按组织+工作区+用户+provider 隔离。

### 4.3 客户端配置

客户端填写 ERP 对外 URL 和对应 MCP Bearer。Amazon/赛狐源 API client secret、数据库 DSN 和加密主密钥不应填入 AI 客户端。

下面是本系统设置页使用的通用配置形状，占位符不可直接运行；不同客户端的配置格式需按其自身版本转换。本说明没有核验当前 Codex/Claude/其他客户端的实际已安装配置。

```json
{
  "mcpServers": {
    "erp-amazon": {
      "url": "https://<ERP域名>/api/mcp/amazon",
      "headers": { "Authorization": "Bearer amcp_<个人令牌>" }
    },
    "erp-sellfox": {
      "url": "https://<ERP域名>/api/mcp/sellfox",
      "headers": { "Authorization": "Bearer sfmcp_<个人令牌>" }
    }
  }
}
```

当前没有共享环境令牌 `MCP_HTTP_TOKEN` 的有效回退。把两种令牌互换应被拒绝；AI 客户端连接成功不自动取得业务权限。

## 5. 个人令牌的生命周期与权限

### 5.1 共通部分

- 随机 32 字节，base64url 后 43 字符；添加各提供方前缀。
- 令牌通过 hash 查找数据库，不以令牌前缀字符串本身授予权限。
- create/rotate 时返回明文；列表接口仅返回前缀和元信息，没有找回原令牌接口。
- 创建有效期限制在未来 90 天内；轮换继承原到期日，不自动延长。
- rotate 撤销旧记录并建立新记录；disable/revoke 增加 revision。
- mutation 带 id+revision，过期版本应冲突，而不是覆盖其他管理操作。
- 创建、轮换、停用、撤销、认证失败、调用成功/拒绝有审计路径。

### 5.2 Amazon 当前实际权限模型

Amazon 读取以实时的“用户被分配了哪些有效 Amazon 账号”为核心。`explicitAmazonDataAccess` 检查 active 成员、工作区访问、有效用户账号分配和 active seller。

必须特别注意：

1. `accountToolsForLili` 会在凭证工具清单上追加所有 Amazon READ_ONLY 工具。
2. view/export 的 `amazonDataAccess` 返回 ERP 实时账号分配；不会再用凭证旧 scopes、mcpEnabled、角色/操作/站点设置收窄读取。
3. 因此界面中的 tools/scopes 不能被理解成当前 Amazon 读取的绝对上限；这是代码的现有账号读取合同。
4. 每次业务工具须显式传 `sellerAccountId` 和 `marketplaceId`；唯一例外是 `amazon.stores.list` 身份发现。
5. 不接受 sellerAccountIds 批量跨账号读取；调用者须按账号/站点逐个查询。
6. 标准数据查询还会检查请求的数据源、有效授权、发布状态；原始行工具刻意允许未发布行，但仍要求当前账号分配和本地站点 source 存在。
7. 非只读操作另走 tool/action/scopes、审批和执行器门禁。不能把“自动获得读取工具”理解为自动得到写入权。

### 5.3 赛狐当前实际权限模型

- 创建 API 入口用 `sellfox:create`；停用/撤销用 edit；probe 用 view。
- 创建时验证店铺 ID 属于组织/工作区，至少选择一个有效工具。
- `storeIds=[]` 的实际语义是全店铺 `*`，包括该工作区后续新增店铺；不是零权限。选择指定 ID 才是固定店铺集合。
- 工具执行按凭证 tools 校验；前缀、工具、数据集均有封闭清单。
- 店铺数据按组织+工作区+店铺过滤；没有店铺列的租户级表仅对 `*` 凭证开放；nullable store 的通用记录对指定店铺凭证不会开放无店铺行。

**安全缺口：赛狐 `authenticateSellfoxMcp` 读取凭证的 ACTIVE/到期状态后直接返回身份，并更新 lastUsedAt；没有像 Amazon 一样重新检查凭证归属用户的 active 状态、组织成员、实时 WorkspaceMembership 和当前业务权限。`invokeSellfoxMcp` 也没有补做这些实时身份检查。** 因此不能宣称“停用用户/撤销工作区访问后，赛狐 MCP 下一请求必然失效”；当前明确可见的阻断是停用/撤销 MCP 凭证本身。需要隔离用例验证并补齐统一服务端授权，不能以页面权限代替 Bearer 请求授权。

## 6. 协议与连接行为

- 双 MCP 是 Next.js Node Route Handler，通过 HTTP JSON-RPC 2.0 提供服务，不是仓库里的 stdio 子进程服务器。
- 支持 initialize、ping、notifications/initialized、tools/list、tools/call；仅声明 tools 能力，不能推断有 resources/prompts/subscriptions。
- initialize 接受 `2024-11-05`、`2025-03-26`、`2025-06-18`。
- POST 要求 JSON Content-Type；有 Origin 时要求同源；没有为任意浏览器跨域配置开放 Access-Control-Allow-Origin。
- 请求体上限为 64,000 字节。Amazon 使用 boundedRequestText；赛狐先读 request.text 再检查字节数，未知 Content-Length 的超大请求未在读取过程中提前截断。
- 响应 no-store；业务结果通过 `content[].text` 的 JSON 返回。协议头为 2025-06-18 且结果为对象时附 structuredContent。
- GET 可用于描述/探测，不能把 GET 200 等同于认证成功或业务查询成功；赛狐 GET 认证失败也返回 authenticated=false 的描述。
- OPTIONS 声明 GET/POST/OPTIONS；这不等于任意 SSE 客户端会话管理、断线续流或批量 JSON-RPC 均已实现。
- 本轮未做真实客户端兼容测试、TLS/反向代理/超时/域名可达性检查。

## 7. 赛狐采集、承接和 MCP 的真实关系

### 7.1 源数据进入 ERP

凭证录入 → 工作区加密记录 → 同步计划/run → Redis/注册 sellfox-sync Worker → API 分页/报表解析 → 本地快照或 `SellfoxApiRecord` → 承接页查询。

内置 14 资源覆盖 stores、listings、inventory、orders、sales、performance、fba_shipments、hourly，以及六类广告报表。内置“全量”指这张规则表和已启用通用端点按指定日期范围展开，不等于赛狐所有 API、全部历史或所有承接栏目。

- `POST /api/sellfox/full-sync` 返回 202/plan，表示任务受理，不表示已完成。
- 默认日期窗为截至昨日的最近 90 天；资源各有单次 chunkDays，广告高量域拆得更细。
- 默认一次计划上限 500 任务；过大范围要求缩小，不是无限回填。
- 通用端点 seed 默认停用，必须登记并启用；未知/未文档化域没有凭空适配。
- 通用行 upsert 到 `SellfoxApiRecord`；原始 JSON payload 保留，但不等于版本化原件档案。
- 7 个 host 页面定义合计 37 个数据集，其中 9 live、28 planned。赛狐 listings/sales/orders 等既有页面不全部计入这个统计；通用原始行入口也单列存在。

### 7.2 本地 MCP 读取

Bearer → `SellfoxMcpCredential` → 工具/数据集白名单 → 组织/工作区/店铺 SQL 围栏 → `MCP_PG_READONLY_URL` → 本地 PostgreSQL。

`query_data` 没有调用赛狐 API；当前 23 数据集封闭登记。工具不是 23 个，而是六个标准工具：

1. `sellfox.stores.list`
2. `sellfox.dataset.overview`
3. `sellfox.query_data`
4. `sellfox.restock_suggestions`
5. `sellfox.ads_diagnosis`
6. `sellfox.sales_trend`

有五个旧工具名别名：dataset_overview、query_data、restock_suggestions、ads_diagnosis、sales_trend，映射至同一 canonical tool，不是另外的授权。

### 7.3 全量读取缺口

- `fields=all` 在 23 个数据集中没有任何 `allColumns` 定义，实际全部回退摘要 `columns`。
- `api_records` 不返回 payload；而 `/api/sellfox/endpoint-records` 会返回 payload。AI 因此拿不到页面已能展示的通用业务响应字段。
- 库存摘要没有页面里的全部仓库/预留/不可售字段，利润摘要没有全部费用明细。
- 多组驼峰 SQL 标识符未加双引号，例如 `t.orderStatus`、`t.endpointCode`、`t.adType`。Prisma migration 建的是 `"orderStatus"`、`"endpointCode"` 等，PostgreSQL 将无引号名称折成小写，按这些迁移建库时相应查询会 undefined_column。
- limit 最大 500；offset 最大 1,000,000。返回当前页 count，没有总量/hasNext/稳定游标合同。
- 分页只按日期降序，没有唯一 id 作为并列排序补充；相同日期行及同步并发时不能保证逐页无遗漏无重复。
- stores.list 固定 LIMIT 200，工具 schema 没有分页参数；超 200 店铺不可据此完整枚举。
- listings/inventory/fba_shipments 采用 SnapshotHead 当前完整版本；不会枚举所有历史快照。若“全部”要求历史版本，当前合同还不满足。
- MCP 自己写 SQL，承接页另有 host-read/workbench/endpoint-records 查询，未全面复用统一业务查询服务，已存在字段与口径分叉。

## 8. Amazon 采集、承接和 MCP

### 8.1 源授权和采集

- SP-API：可录入 LWA Client ID、Secret、Refresh Token、区域；保存是审批请求，批准后仍须应用；卖家真实身份/站点不能靠手填字符串证明。也有独立 OAuth start/callback。
- Ads：应用 ID/Secret 来自服务端，页面 OAuth 获得授权并发现 Profile，须关联现有 ERP 卖家/站点。没有把所有 Ads 应用凭证做成当前页面可直接手填的统一表单。
- 官方请求只允许 cloud 执行角色。local 查询落地数据与 cloud 采集是不同能力。
- SP 自动适配器已有订单、库存、Catalog、销售流量、财务、退货、结算、赔付、库龄、库存事件、Inbound/商品/价格/品牌等多个域；下面附录按当前注册表完整列出。注册不能证明真实账号有角色、历史无限可取或已经采集完整。
- Ads 已实现 SP 九类结构读取、五类绩效报表适配；非 profiles 的 SB/SD 域明确 NOT_IMPLEMENTED。SP portfolios、budget-bidding、creative-brand 也未实现。
- SP 报表有来源保留时间，例如 search term 65 天、其他已登记报表 95 天及单请求 31 天窗口；不能承诺恢复上游未保留历史。
- SP 结构是当前快照/采集观察，不是全域原子发布或 Amazon 完整变更历史。

### 8.2 MCP 两种数据口径

| 读取方式 | 目标 | 发布语义 | 连接 |
|---|---|---|---|
| data_query、Ads reports/entities 及业务专用读工具 | 标准业务事实、指标、Listing 属性等 | 按各服务授权、来源和发布合同 | 多数复用主 Prisma/ERP 服务 |
| amazon.data.archive.read | 已归档响应的受控读取 | 受专门归档/解密合同 | 不代表所有密文任意可读 |
| amazon.data.local.tables | 物理表、列、范围内精确行数 | 原始本地落地行，可能含失败/未发布过程数据 | 独立 Amazon 只读 DSN |
| amazon.data.local.read | 白名单表全部非敏感物理字段及分页 | 同上，不是已发布业务事实 | 独立 Amazon 只读 DSN |

本地原始行目录显式分可读、安全排除、无租户表三类。敏感列在 SQL 投影阶段剔除；JSON 嵌套中的令牌、email/phone/address/buyer name 等会递归脱敏。安全排除不应理解为普通业务数据缺失已被解决。

原始行工具只访问数据库，不请求 Amazon 官方 API。但 Amazon MCP 总目录还包含同步/变更类工具，不能将整个服务器称为“任何调用都无副作用”。仅用读工具/独立只读入口才能按读取目标验收。

### 8.3 当前功能缺陷

1. **参数声明与执行不一致**：`amazon.data.local.read` 声明 fromDate、toDate、sortDirection、filterColumn/filterValue；`argumentsObject` 未把 local 工具纳入 schema 参数校验分支，通用白名单没有这些字段。使用任一上述参数会在读取前返回 FIELD_NOT_MAPPED。本轮从当前源码提取真实校验函数，纯内存复现了这些拒绝；基础 table/page/pageSize 被接受。
2. **租户级表实际上打不开**：localFence.tenantWide 来自 `amazonDataAccess(...view).allSellers`；读取授权路径固定返回 allSellers=false。故虽然目录说“全店铺授权可读”，正常 MCP 读取路径没有产生 true 的条件。日志、计划等没有 seller/profile/source 围栏的表会被拒绝。
3. **所有读工具并未全面走独立只读角色**：原始行工具独立，其他业务查询仍有主 Prisma。角色审计通过不能代替所有工具的查询连接路径验收。
4. **分页上限及排序**：原始行工具 page 最大 10,000、pageSize 最大 1,000；按一列日期/主键排序，不统一追加唯一二级排序。单次请求 RepeatableRead 并不能让多页请求共享同一数据库快照；大量同日期数据/并发同步下完整遍历有风险。
5. **目录统计成本**：local.tables 对范围内多张表精确 count，15 秒 statement timeout；大数据量能否完成未做本轮 benchmark。
6. **统一服务边界不足**：local-raw-read 当前调用方主要是 MCP，并非承接页所有查询都共用此服务；仍需逐数据域核对页面与 MCP 的字段、发布与实时授权合同。

## 9. Lili 的配置与能力边界

- `/api/lili/mcp` 匿名 initialize、公共 Skills 发现/加载和公共研究准备可用；匿名不能据此读取租户业务、保存研究或取得凭证。
- Bearer 分支复用 Amazon 凭证认证；不是单独的 sfmcp_ 入口。
- OAuth metadata：`/.well-known/oauth-authorization-server`、`/.well-known/oauth-protected-resource`、`/.well-known/oauth-protected-resource/api/lili/mcp`。
- OAuth 服务端端点由 metadata 暴露，位于 `/api/lili/oauth/` 的 register/authorize/token/revoke。
- 使用 S256 PKCE，resource 精确绑定规范 origin 的 `/api/lili/mcp`；不能把资源绑定的 Lili OAuth access token 当作普通 Amazon MCP 通用 token。
- 配对 ID/密钥 5 分钟有效，单次交换；设备凭证最长 30 天且不超过父凭证到期。OAuth authorization code 60 秒，访问令牌最长 1 小时，refresh token 轮换，总授权仍受设备/父凭证约束。
- 父凭证、设备状态、到期和链路有检查；撤销父凭证会影响设备。配置界面所说“继承选中凭证范围”还须结合前述 Amazon 账号读取合同理解：读取工具自动补齐、范围以实时账号分配为主。
- 外部研究不是仅靠“只读”标签就自动执行；runtime 将外部研究标记为 approval_required，并受现有研究授权/付费调用同意等门禁。
- 西柚配置固定地址、Token 单独保存，不接受带 Bearer 前缀、占位符、换行或任意改地址；密文绑定组织/工作区/用户。
- SellerSprite 当前保存把 settings（包含 apiKey）直接写入 ExternalIntegrationSetting.config，本服务代码未做西柚式 seal 加密；对外返回有公共脱敏形状。这里说的是应用层存储方式，不推断底层磁盘是否加密。两外部 provider 的敏感配置保护不一致，须整改评审。
- “初始化已响应”仅证明 MCP initialize，不证明付费额度、业务 tools/call、某个 ASIN 数据、全部工作流或 ERP 数据权限成功。

## 10. 数据库只读和双域隔离究竟做到哪里

### 10.1 已提供机制

- 两种 token、凭证表、端点、namespace、数据集/表白名单和审计前缀独立。
- 预期独立登录：amazon_mcp_ro、sellfox_mcp_ro。
- 业务表前缀分别 Amazon*、Sellfox*；同一数据库里按角色 ACL 隔离，不要求物理两套库。
- 赛狐连接 max=3，默认只读，statement timeout 30 秒、query timeout 35 秒；每次 BEGIN READ ONLY。
- Amazon 原始行连接 PrismaPg，默认只读、statement timeout 15 秒；RepeatableRead 事务 timeout 20 秒并 SET TRANSACTION READ ONLY。
- `database-audit.mjs` 统一供 CLI、状态接口和探针使用。查 current_user/session_user、有效表/列权限、其他 schema、序列/视图、写入、转授权、成员/SET ROLE、所有权、超级权限、CREATE/TEMP、应用函数 EXECUTE、PUBLIC/default ACL。
- 实际跨域 SELECT 使用另一提供方表 LIMIT 0，在 SAVEPOINT 中要求 PostgreSQL 返回 42501。空库、缺另一侧表、连接失败都不是通过。

### 10.2 运维命令的真实效果

| 命令/文件 | 实际效果 | 本轮执行 |
|---|---|---|
| `npm run mcp:roles` | 只输出 grant-roles.sql，不创建角色、不连接库、不实施授权 | 未执行 |
| `scripts/mcp-isolation/grant-roles.sql` | DBA 手工执行后才变更 ACL；前置不安全就整事务失败 | 未执行 |
| `node scripts/mcp-isolation/audit-roles.mjs` | 连接两条实际只读 DSN，只读审计；直接脚本不自动加载 .env | 未连接运行 |
| 状态页“探针” | 用目标 provider 实际独立登录执行权限审计 | 未调用 |
| `scripts/mcp-isolation/smoke.ts` | 含创建/撤销凭证等动作，并非纯只读检查 | 未执行 |
| `scripts/mcp-isolation/issue-token.ts` | 选库里第一个组织成员、default 工作区，写凭证并打印令牌 | 未执行；不应当成生产常规配置入口 |

DBA SQL 不设置密码或创建 LOGIN；它假定安全角色预建，并拒绝 PUBLIC/成员/所有权/默认 ACL 等不安全状态。新增表后不会因未来默认权限自动变为可读，须再次审核授权。

### 10.3 仍然存在的差异

- ACL 脚本给本 provider 所有前缀普通表 SELECT，包含某些应用层不对 MCP 暴露的凭证表。因此是提供方隔离，不是字段级或业务最小清单；不要把数据库连接串交给 AI 客户端。
- ACL 脚本/审计明确不允许视图，而赛狐趋势/补货/广告诊断会查 sellfox_sales_daily、sellfox_inventory_current 视图。严格按该 ACL 实施后，这些分析工具不能凭当前角色读取相应视图；若额外授予视图 SELECT，又会使当前审计失败。需要统一查询与数据库权限合同，不能只宣布双角色审计通过。
- 数据库角色主要隔离提供方，不替代组织、工作区、用户、店铺行级授权；当前安全依赖应用 SQL 围栏，不可宣称数据库已自动实施每租户 RLS。
- 双只读 URL 存在只说明配置存在；默认只读参数本身可被客户端更改，实际只读保证需要 ACL。
- 当前审计不能证明所有扩展、FDW、跨库、SECURITY DEFINER、网络出口等环境特有路径完全安全；专项文档也保留这些边界。

## 11. 状态、错误和审计的阅读方式

- Amazon 无效 Bearer/过期/停用通常 401；无授权 403；参数问题 400；未配置/无效来源等有明确业务错误。
- 赛狐区分 PROVIDER_MISMATCH、STORE_NOT_ALLOWED、TOOL_NOT_ALLOWED 等，但只读 DSN 未配置也被标成 PROVIDER_MISMATCH+503，分类不够精确。
- 赛狐执行 catch 把多类错误统一写 failureClass=ACCESS_DENIED，即使 SQL undefined_column 也是这样记录；不能据此认定全是权限问题。
- Amazon 专项调用日志按组织、用户、metadata.workspaceId 查询，支持状态/工具/失败分类和分页。
- 统一 MCP 面板最近事件只按 organizationId 过滤，未见当前 workspaceId/userId 过滤；不能把它称为当前用户当前工作区独享的审计视图。返回虽只含事件元信息，仍应核对产品及权限合同。
- lastUsedAt 的语义不同：赛狐在认证成功就更新；不等于业务查询成功。Lili Bearer 成功审计有更新路径，Amazon 调用也有自己的记录逻辑。
- 保存凭证、连接成功、工具可见、任务排队、采集成功、完整发布、MCP 业务回读成功是七种不同证据，不应互相代替。

## 12. 已发现问题与处理优先级

| 编号 | 优先级 | 问题 | 影响 |
|---|---|---|---|
| MCP-01 | 高 | 赛狐 Bearer 路径缺实时成员/用户/工作区权限复核 | 撤权/停用不能按 Amazon 标准立即生效 |
| MCP-02 | 高 | 赛狐 SELECT 驼峰列未正确引用 | 多组 query_data 数据集按现有迁移执行会报列不存在 |
| MCP-03 | 高 | 赛狐 fields=all 无完整列、payload 不返回 | 已承接本地业务内容无法完整读取 |
| MCP-04 | 高 | 赛狐分析视图与角色 ACL 规则冲突 | 严格隔离角色下分析工具失败，额外授权又导致审计失败 |
| MCP-05 | 高 | Amazon local.read 参数 schema 与入口白名单不一致 | 日期/排序/列过滤已复现被拒绝 |
| MCP-06 | 中 | Amazon 原始行租户级表 allSellers 通路不可达 | 目录宣称可读的数据类别实际上打不开 |
| MCP-07 | 中 | 页面/MCP 平行查询、字段口径未统一 | 难保证页面可见即 MCP 可读 |
| MCP-08 | 中 | 分页不稳定、行数/offset/page上限、店铺枚举截断 | 无法保证高数据量全量遍历 |
| MCP-09 | 中 | 部分 Amazon 业务读使用主连接 | 独立只读角色审计不能覆盖全部工具 |
| MCP-10 | 中 | SellerSprite 配置未见应用层加密 | 与西柚等敏感配置保护不一致 |
| MCP-11 | 中 | 统一面板入口权限、异常吞空及事件范围不精确 | 状态可能误导、审计隔离合同待统一 |
| MCP-12 | 低 | .env.example/页面中遗留说明与代码不一致 | 易配错、误判授权已实施或旧地址可用 |

这里的优先级是审计建议，不代表已自动批准权限/共享边界变更。修复应先形成具体变更范围，复用统一服务端查询和实时授权，不新增一套 MCP 专属业务口径。本轮未修复上述业务代码。

## 13. 本轮验证与未验证

### 13.1 已运行

- 第一组 10 个文件，71 项通过：mcp-isolation、mcp-isolation-route、sellfox-mcp-datasets、amazon-mcp-local-raw、amazon-mcp-scope、amazon-mcp-datasets、amazon-ads-capabilities、sellfox-sync-rules、sellfox-auto-sync、sellfox-host-read。
- 第二组 4 个文件，28 项通过：mcp-db-isolation、lili-public-mcp、lili-oauth、lili-tool-config。
- 合计 **99 项现有离线测试通过**。子进程仅继承 PATH/TMPDIR 和 NODE_ENV=test，不加载根 .env，不继承真实数据库/API凭证；测试使用纯函数、静态源码或假客户端/fixture。
- 提取当前真实 `argumentsObject` 源码纯内存执行，复现 Amazon local.read：基础参数接受；fromDate、toDate、sortDirection、filterColumn/filterValue 被拒绝。
- 注册表纯内存统计：赛狐 23 数据集，0 个 allColumns；hostSummary 为 7 页/37 数据集/9 live/28 planned。
- 比较本地与 17f3c63 本次相关核心目录，无差异。

### 13.2 通过测试并不等于缺陷不存在

- 多个现有测试检查“字符串/字段名存在”，未将生成 SQL 发给 PostgreSQL。因此没有挡住驼峰标识符引用错误。
- local.read 测试检查 schema 与源码片段，没有覆盖实际入口参数校验，因而漏掉 FIELD_NOT_MAPPED。
- 角色测试用假客户端或权限快照，没有覆盖当前业务分析视图在严格 ACL 下的查询成功性。
- 没有全字段与承接页逐列对照用例，fields=all 退回摘要依旧能通过现有测试。

### 13.3 未运行或无法据此确认

- 真实数据库角色/ACL/两条 DSN、在线账号状态、凭证数量、用户分配、表行数、采集覆盖/失败窗口。
- 实际服务器 release SHA、CI artifact、迁移实施、Web/Worker 环境一致性、队列消费与重启恢复。
- 真实 Amazon/赛狐凭证验证、全分页/全历史采集、真实授权撤销、官方限流及下载。
- 真实客户端 HTTP/OAuth 互通、域名/TLS/代理/SSE/请求超时。
- 目标 PostgreSQL 生成 SQL 执行及真实跨提供方/跨租户负向查询。
- 大数据量全遍历、并发同步期间分页一致性及 P95。
- 全套 check/build/typecheck：本轮是只读审计和文档，不以构建代替上述链路验证，也没有修改业务代码。

## 14. 宣称“已配置完善”前应取得的证据

1. 先确认目标 release 为包含这批功能的版本；若是 883afa4，不能靠配置补出缺失源码。
2. 核验配置来源和安全持久密钥，区分上游 API 凭证、MCP 个人 token、数据库只读 DSN、Lili OAuth 和外部研究 token。
3. 补齐高优先级代码缺陷，并为实际 SQL、实时撤权、全字段映射、完整分页增加有意义的隔离验证。
4. 统一页面与 MCP 的查询服务、权限和数据口径；将可读范围/敏感排除/历史策略写成可核对清单。
5. 在明确授权的环境完成迁移/ACL，由两个真实只读登录审计；查询功能与最小权限同时成功，不能靠放宽到主库管理员来验收。
6. 每个已声明可用的数据域，核对同步任务完成状态、页数、源记录量、落地记录量、发布边界和日期覆盖，列出失败/未知项。
7. 从 ERP 页面与对应 MCP 读取同一组织/工作区/账号/站点/日期样本及首末页，逐字段比对；断开上游 API 访问时，本地读取仍应成立。
8. 验证跨提供方 token、跨租户、跨工作区、未分配账号、停用用户、撤销成员/凭证均阻断；同时验证本人授权数据正常可读。

上述是剩余验收条件，不是本轮已经执行的操作。GitHub/服务器没有因本说明而更新。

## 15. 源码定位

- 策略：`src/lib/mcp/isolation.ts`。
- 数据库审计/授权：`src/lib/mcp/database-audit.mjs`、`scripts/mcp-isolation/`、`docs/mcp-isolation-amazon-sellfox.md`。
- 对外双入口：`src/app/api/mcp/amazon/route.ts`、`src/app/api/mcp/sellfox/route.ts`。
- 双面板：`src/components/settings/mcp-settings-panel.tsx`、`src/components/operations/amazon-mcp-panel.tsx`、`src/app/api/operations/mcp-isolation/route.ts`。
- Amazon 认证/调用：`src/lib/amazon-sync/mcp.ts`、`mcp-tool-registry.ts`、`data-access.ts`、`mcp-scope.ts`、`src/lib/lili/account-tool-access.ts`。
- Amazon 本地原始行：`src/lib/amazon-sync/local-raw-catalog.ts`、`local-raw-read.ts`。
- 赛狐认证/SQL/目录：`src/lib/sellfox/mcp.ts`、`mcp-tool-registry.ts`。
- 赛狐源凭证/编排：`src/lib/sellfox/credential-store.ts`、`sync-orchestrator.ts`、`sync-rules.ts`、`known-endpoints.ts`。
- 赛狐页面数据：`src/lib/sellfox/host-pages.ts`、`host-read.ts`、`src/app/api/sellfox/endpoint-records/route.ts`。
- Amazon 采集能力：`src/lib/amazon-sync/automatic-adapters.ts`、`src/lib/amazon-ads/capabilities.ts`、`authorization.ts`。
- Lili：`src/lib/lili/api.ts`、`public-mcp.ts`、`research-bearer-server.ts`、`runtime-server.ts`、`oauth.ts`、`device-pairing.ts`。
- 外部研究设置：`src/lib/server/integration-settings.ts`、`src/lib/lili/tool-config-server.ts`。

以下附录由上述代码注册表在不连接真实服务的子进程中生成，表示静态目录；不是当前用户 tools/list 的真实返回或线上已采集清单。

## 附录 A：赛狐 MCP 的 23 个登记数据集

所有数据集当前 allColumns 都未定义；下表为实际 SELECT 白名单。字段名称去掉 SQL 引号以便阅读；未加引号的驼峰缺陷见正文。

| key | 物理表 | 范围模式 | 当前态过滤 | 实际返回列 |
| --- | --- | --- | --- | --- |
| stores | SellfoxStore | tenant_store | 无 | externalId, name, marketplace, country, status |
| listings | SellfoxListingSnapshot | tenant_store | listings | storeId, msku, asin, title, price, fulfillable, status, capturedAt |
| inventory | SellfoxFbaInventorySnapshot | tenant_store | inventory | storeId, msku, asin, sku, quantity, totalInventory, inTransit, reportDate |
| sales | SellfoxSalesDailySnapshot | tenant_store | 无 | storeId, msku, asin, reportDate, orders, quantity, revenue, currency |
| orders | SellfoxOrderSnapshot | tenant_store | 无 | storeId, orderId, asin, msku, purchaseDate, qty, itemAmount, orderStatus, fulfillmentChannel, latestCapturedAt |
| performance | SellfoxProductDailySnapshot | tenant_store | 无 | storeId, asin, msku, reportDate, orderNum, saleRevenue, grossProfit, grossProfitRate, onlySettle |
| ads_product | SellfoxAdsProductDaily | tenant_store | 无 | storeId, asin, reportDate, impressions, clicks, cost, adSales, adOrders |
| ads_campaign | SellfoxAdsCampaignDaily | tenant_store | 无 | storeId, campaignId, campaignName, reportDate, impressions, clicks, cost, adSales, adOrders |
| fba_shipments | SellfoxFbaShipmentSnapshot | tenant_store | fba_shipments | storeId, shipmentId, shipmentName, asin, msku, sku, declaredQty, shippedQty, receivedQty, status, sourceCreatedAt, shippedAt |
| ads_ad_group | SellfoxAdsAdGroupDaily | tenant_store | 无 | storeId, campaignId, adGroupId, adGroupName, reportDate, adType, impressions, clicks, cost, adSales, adOrders |
| ads_targeting | SellfoxAdsTargetingDaily | tenant_store | 无 | storeId, campaignId, adGroupId, targetingId, targetingText, matchType, reportDate, adType, impressions, clicks, cost, adSales, adOrders |
| ads_search_term | SellfoxAdsSearchTermDaily | tenant_store | 无 | storeId, campaignId, adGroupId, searchTerm, reportDate, adType, impressions, clicks, cost, adSales, adOrders |
| ads_placement | SellfoxAdsPlacementDaily | tenant_store | 无 | storeId, campaignId, placement, reportDate, adType, impressions, clicks, cost, adSales, adOrders |
| ads_hourly | SellfoxHourlyMetric | tenant_store | 无 | storeId, reportDate, hour, adType, entityType, entityId, entityName, impressions, clicks, cost, sales, orders |
| api_records | SellfoxApiRecord | tenant_store | 无 | endpointCode, storeId, scopeKey, period, externalId, syncedAt |
| coverage | SellfoxCoverage | tenant_store | 无 | resource, storeId, firstDate, lastDate, rowCount, lastRunId, lastStatus, updatedAt |
| api_endpoints | SellfoxApiEndpoint | tenant_only | 无 | code, label, dateMode, scopeMode, chunkDays, pageSize, maxRows, enabled, createdAt |
| sync_runs | SellfoxSyncRun | tenant_only | 无 | resource, status, error, startedAt, finishedAt, summary |
| sync_shards | SellfoxSyncShard | tenant_only | 无 | resource, scopeKey, period, status, rows, runId, startedAt, updatedAt, finishedAt |
| sync_schedules | SellfoxSyncSchedule | tenant_only | 无 | resource, enabled, intervalMinutes, backfillStart, backfillNextDate, lastEnqueuedAt |
| product_backfill | SellfoxProductBackfillState | tenant_only | 无 | nextReportDate, emptyDayStreak, status, lastError, lastRunAt, completedAt |
| snapshot_head | SellfoxSnapshotHead | store_join | 无 | storeId, resource, capturedAt |
| sales_day_coverage | SellfoxSalesDayCoverage | store_join | 无 | storeId, reportDate, capturedAt, rowWrites |

## 附录 B：Amazon MCP 静态工具目录

下面含 canonical 和现有 alias；最终可发现性还受可调用状态、实时账号授权及非只读门禁影响。不是每个列出工具都已经通过真实调用验收。

登记条目数：45。

| 工具名 | canonical | operationMode | action | 描述 |
| --- | --- | --- | --- | --- |
| promotions_search | promotions_search | READ_ONLY | view | 查询本地已发布促销摘要；单账号、单站点，不实时调用 Amazon |
| promotions_get | promotions_get | READ_ONLY | view | 读取本地促销完整详情及发布/最新修订；费用快照不是实际花费 |
| promotions_get_items | promotions_get_items | READ_ONLY | view | 分页读取本地促销 Selection 商品、折扣和预算；CATALOG 仅保留规则；kind=PROMOTION_SELECTION 返回完整商品分页及商品异常 |
| inventory_get_snapshot | inventory_get_snapshot | READ_ONLY | view | 分页读取 SP-API 已发布 FBA 库存快照；日期为 capturedAt UTC，不代表历史事件或全部库存渠道 |
| inventory_get_events | inventory_get_events | READ_ONLY | view | 分页读取 Reports GET_LEDGER_DETAIL_VIEW_DATA 已发布且归属验证通过的库存事件；日期为事件业务日期，重叠报告不可直接相加 |
| inventory_get_age | inventory_get_age | READ_ONLY | view | 分页读取 Reports GET_FBA_INVENTORY_PLANNING_DATA 最新已发布库龄快照；reportId 可指定历史版本，不累加快照 |
| reimbursement_get_events | reimbursement_get_events | READ_ONLY | view | 分页读取已发布 Ledger 库存事件证据；不是未结索赔或资格判断，未归属/未发布不等于没有损失 |
| reimbursement_get_payments | reimbursement_get_payments | READ_ONLY | view | 分页读取 Reports GET_FBA_REIMBURSEMENTS_DATA 已发布赔付记录，按 approval-date；原币种金额与数量文本保留，不代表已关联库存事件 |
| reimbursement_analyze | reimbursement_analyze | READ_ONLY | view | 只读分析同一账号/站点的库存事件、赔付报告和财务交易；逐域分页、校验覆盖并保留证据。仅使用已验证关联键，未知关联标记 UNMATCHED/UNABLE_TO_CONFIRM |
| returns_get_items | returns_get_items | READ_ONLY | view | 分页读取单份已发布 FBA 仓收退货报告，按 returnAt UTC；不代表全渠道退货、退款或完整历史 |
| orders_search | orders_search | READ_ONLY | view | 分页读取已入库订单及详情完整性，默认 createdTime UTC，可显式选择 sourceUpdatedAt；不实时请求 Amazon |
| orders_get_items | orders_get_items | READ_ONLY | view | 分页读取已入库订单商品行及数量、SKU、ASIN、原币金额，默认订单创建日期；明细缺失不能解释为零 |
| finance_get_transactions | finance_get_transactions | READ_ONLY | view | 分页读取 Finances v2024-06-19 已入库交易；保留原金额、币种、交易类型及 postedAt UTC，读取继承账号分配 |
| finance_get_settlements | finance_get_settlements | READ_ONLY | view | 分页读取 Reports GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 的已发布结算明细；保留原始币种和交易粒度，不将报告头当作交易金额 |
| get_listings | get_listings | READ_ONLY | view | 只读分页查询单账号、单站点最近成功发布的 Listing 快照；支持 SKU、ASIN、状态及 UTC 采集日期筛选，不是商品主档或完整 Catalog |
| get_inventory | get_inventory | READ_ONLY | view | 只读分页查询单账号、单站点最近成功发布的库存快照；日期筛选为 UTC 采集日期，不是库存事件历史 |
| get_sales | get_sales | READ_ONLY | view | 只读分页查询单账号、单站点指定业务日期范围的店铺逐日销售流量；不提供 SKU/ASIN 拆分，保留原币与精确数值文本 |
| get_orders | get_orders | READ_ONLY | view | 只读分页查询单账号、单站点已入库订单，包含明细完整性和金额缺失提示 |
| get_order_items | get_order_items | READ_ONLY | view | 只读分页查询单账号、单站点订单商品行，支持订单、SKU、ASIN 和日期筛选 |
| amazon.fields.coverage | amazon.fields.coverage | READ_ONLY | view | 只读实际覆盖报告：查看原件、映射、批次核对、业务可见行和结算缺币种数量；不代表官方全字段完成 |
| amazon.fields.catalog | amazon.fields.catalog | READ_ONLY | view | 只读字段目录：显示已归档原件观察及未映射状态；不表示字段已完整接通 |
| amazon.data.archive.read | amazon.data.archive.read | READ_ONLY | view | 只读分页读取已保存原件的业务字段，保留未知字段和精确数字文本；JSON 可指定 RFC 6901 pointer，TSV 保留列顺序。秘密不返回；原件不代表已发布业务事实 |
| amazon.ads.reports.list | amazon.ads.reports.list | READ_ONLY | view | 只读查询本地最新已发布广告日报；读取继承账号分配 |
| amazon.ads.entities.list | amazon.ads.entities.list | READ_ONLY | view | 只读分页查询已同步的 SP 广告结构；无报告日期维度 |
| ads_list_entities | amazon.ads.entities.list | READ_ONLY | view | Skill 兼容别名：只读查询已同步的 SP 广告结构 |
| ads_get_campaign_structure | amazon.ads.entities.list | READ_ONLY | view | Skill 兼容别名：只读查询活动结构 |
| ads_get_sync_status | ads_get_sync_status | READ_ONLY | view | Skill 兼容别名：读取 Ads 同步和发布状态 |
| ads_get_data_health | ads_get_data_health | READ_ONLY | view | Skill 兼容别名：读取 Ads 数据完整性和 Schema 状态 |
| ads_get_connection_status | ads_get_connection_status | READ_ONLY | view | Skill 兼容别名：读取 Ads 连接状态 |
| ads_get_settings | ads_get_settings | READ_ONLY | view | Skill 兼容别名：读取 Ads Profile、合同和同步配置摘要 |
| amazon.stores.list | amazon.stores.list | READ_ONLY | view | 查询当前授权店铺和站点 |
| amazon.inventory.list | amazon.inventory.list | READ_ONLY | view | 查询最近已同步的库存 |
| amazon.inventory.summary | amazon.inventory.summary | READ_ONLY | view | 汇总授权库存 |
| amazon.catalog.list | amazon.catalog.list | READ_ONLY | view | 查询最近已同步的刊登 |
| amazon.sales.list | amazon.sales.list | READ_ONLY | view | 查询店铺逐日销售流量快照 |
| amazon.sync.status | amazon.sync.status | READ_ONLY | view | 查询同步状态 |
| amazon.history.read | amazon.history.read | READ_ONLY | view | 查询成功同步的历史库存或刊登快照 |
| amazon.sales.export | amazon.sales.export | READ_ONLY | export | 导出最多 1000 条授权销售快照 |
| data_list_tables | data_list_tables | READ_ONLY | view | 列出当前授权范围内有已发布数据的 Skill 逻辑表 |
| data_describe_table | data_describe_table | READ_ONLY | view | 查看已接入 Skill 逻辑表的字段、粒度和限制 |
| data_query | data_query | READ_ONLY | view | 分页查询已接入 Skill 逻辑表的已发布数据 |
| data_sync_status | data_sync_status | READ_ONLY | view | 查询当前授权数据源和同步状态 |
| data_sync_start | data_sync_start | APPROVAL_REQUEST | sync | 提交同步申请；审批并应用后才会创建同步任务 |
| amazon.data.local.tables | amazon.data.local.tables | READ_ONLY | view | 只读列出 Amazon 本地承接池全部真实物理表、物理列清单、敏感列与授权围栏内的精确行数；同步日志/调度/审计等租户级表仅在全店铺授权下可读；口径为原始落地行，不是已发布业务事实 |
| amazon.data.local.read | amazon.data.local.read | READ_ONLY | view | 只读分页读取 Amazon 本地承接池指定物理表的整行全部可见物理字段；强制租户与单账号单站点围栏，敏感列在 SQL 投影层剔除；租户级表（同步日志/调度/批次/审计）仅全店铺授权可读，单 Seller Account 凭证拒绝；原始落地行不等于已发布业务事实 |

## 附录 C：Amazon 原始行表清单

可读目录 45 张；安全排除 17 张；无租户围栏 2 张。可读目录不代表当前登录拥有每张表的范围或真实库已迁移。

可读目录：

`AmazonSellerBinding`, `AmazonAdsProfile`, `AmazonAdsSyncPlan`, `AmazonAdsSyncTask`, `AmazonAdsEntityRecord`, `AmazonAdsSyncDomainState`, `AmazonAdsSyncAttempt`, `AmazonAdsReportVersion`, `AmazonAdsReportFact`, `AmazonAdsReportRequest`, `AmazonAdsReportDocument`, `AmazonAdsChangeDraft`, `AmazonAdsEntityHistory`, `AmazonSyncRun`, `AmazonSyncSchedule`, `AmazonSyncPlanTarget`, `AmazonSyncTaskLog`, `AmazonSyncApiBudget`, `AmazonSyncResourceCursor`, `AmazonSyncDataSource`, `AmazonDataSourceRegistry`, `AmazonSellerIdentity`, `AmazonInventorySnapshot`, `AmazonCatalogSnapshot`, `AmazonCatalogImageReference`, `AmazonSalesTrafficSnapshot`, `AmazonSyncReportDocument`, `AmazonSyncReportRow`, `AmazonOrderRecord`, `AmazonOrderItemRecord`, `AmazonOrderDetailWork`, `AmazonFinanceRecord`, `AmazonReturnReason`, `AmazonReturnRecord`, `AmazonSettlementReport`, `AmazonSettlementRow`, `AmazonDomainObservation`, `AmazonFieldMappingVersion`, `AmazonFieldObservation`, `AmazonReplenishmentPolicy`, `AmazonReplenishmentPlan`, `AmazonDataExport`, `AmazonDataAccessGrant`, `AmazonRoleDataAccessGrant`, `AmazonAgentActionAudit`

安全排除：

| 表 | 原因 | 替代入口 |
| --- | --- | --- |
| AmazonSettlementAllocation | FINANCE_ACTION_REQUIRED | 结算分摊工作台 |
| AmazonSettlementAllocationLine | FINANCE_ACTION_REQUIRED | 结算分摊工作台 |
| AmazonIntegrationConnection | CREDENTIAL_STORE | 授权管理页 |
| AmazonIntegrationSecret | CREDENTIAL_STORE | 授权管理页 |
| AmazonAdsAuthorization | CREDENTIAL_STORE | Ads 授权管理页 |
| AmazonSpApiAuthorization | CREDENTIAL_STORE | SP-API 授权管理页 |
| AmazonMcpCredential | CREDENTIAL_STORE | MCP 凭证管理页 |
| AmazonOAuthAttempt | AUTH_ATTEMPT | — |
| AmazonAdsOAuthAttempt | AUTH_ATTEMPT | — |
| AmazonDataCenterSealedCommand | SEALED_COMMAND | — |
| AmazonDataCenterChangeRequest | CHANGE_APPROVAL | 变更审批页 |
| AmazonDataCenterConfigVersion | INTERNAL_CONFIG | — |
| AmazonFinanceQuarantine | CIPHERTEXT_ONLY | — |
| AmazonSyncRawPage | ENCRYPTED_RAW_PAGE | amazon.data.archive.read（受控解密） |
| AmazonSyncPage | PAGINATION_CURSOR | — |
| AmazonCatalogImageBlob | BINARY_BLOB | 商品图片引用表 |
| AmazonFieldRegistry | INTERNAL_FIELD_REGISTRY | amazon.fields.catalog |

无租户表：`AmazonAdsApiBudget`, `AmazonSyncTokenBucket`

## 附录 D：SP-API 自动适配器注册表

周期是注册表的计划配置，非本轮实测运行频率。

| resource | 执行种类 | 发现范围 | 间隔分钟 |
| --- | --- | --- | --- |
| fba_inventory_by_country | domain_report | marketplace | 60 |
| fba_customer_sales | domain_report | marketplace | 1440 |
| mfn_returns | domain_report | marketplace | 1440 |
| removal_order_report | domain_report | marketplace | 1440 |
| removal_shipment_report | domain_report | marketplace | 1440 |
| fba_shipments | domain_report | marketplace | 1440 |
| storage_fees | domain_report | marketplace | 1440 |
| recommended_removals | domain_report | marketplace | 1440 |
| fba_overage_fees | domain_report | marketplace | 1440 |
| fee_preview | domain_report | marketplace | 1440 |
| long_term_storage_fees | domain_report | marketplace | 1440 |
| fba_fulfilled_inventory | domain_report | marketplace | 60 |
| fba_inventory_report | domain_report | marketplace | 60 |
| reserved_inventory | domain_report | marketplace | 60 |
| stranded_inventory | domain_report | marketplace | 60 |
| promotions | observation | marketplace | 360 |
| catalog | catalog | marketplace | 1440 |
| inventory | inventory | marketplace | 60 |
| orders | orders | marketplace | 60 |
| sales_traffic | report | marketplace | 1440 |
| finance | finance | seller | 1440 |
| returns | returns | marketplace | 1440 |
| settlements | domain_report | marketplace | 1440 |
| reimbursements | domain_report | marketplace | 1440 |
| inventory_age | domain_report | marketplace | 1440 |
| inventory_events | domain_report | marketplace | 1440 |
| fulfillment | observation | marketplace | 120 |
| listing_details | observation | marketplace | 1440 |
| catalog_items | observation | marketplace | 1440 |
| pricing | observation | marketplace | 60 |
| brand_analytics | observation | marketplace | 1440 |
| buy_box_history | observation | marketplace | 1440 |
| notifications | observation | seller | 1440 |

## 附录 E：赛狐内置采集规则


| 资源 | 标签 | 日期模式 | 单任务天数 | 间隔分钟 | 可调度 |
| --- | --- | --- | --- | --- | --- |
| stores | 店铺列表 | none | 0 | 480 | True |
| listings | 在线产品 | current | 0 | 1440 | True |
| inventory | FBA 库存 | current | 0 | 180 | True |
| orders | 订单 | range | 90 | 720 | True |
| sales | 销量快照 | range | 90 | 1440 | True |
| performance | 产品日利润 | range | 90 | 1440 | True |
| fba_shipments | 货件 | range | 90 | 720 | True |
| hourly | 小时样本 | current | 1 | 1440 | False |
| ads_report | 广告商品报表 | range | 14 | 1440 | True |
| ads_campaign | 广告活动报表 | range | 14 | 1440 | True |
| ads_ad_group | 广告组报表 | range | 14 | 1440 | True |
| ads_placement | 广告位报表 | range | 14 | 1440 | True |
| ads_targeting | 广告投放报表 | range | 7 | 1440 | True |
| ads_search_term | 广告搜索词报表 | range | 7 | 1440 | True |

## 附录 F：赛狐七个 host 页面逐数据集状态

此表仅反映配置文件状态；planned 不等于所有业务绝无原始数据，已启用通用端点的原始行可能在独立 endpoint-data 入口。live 也不证明真实环境已采集。

### 商品资料（/sellfox/products）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| sku | SKU 商品库 | planned | SellfoxSkuMaster | — |
| spu | SPU 款名 | planned | SellfoxSpuMaster | — |
| category | 分类 / 品牌 / 属性 | planned | SellfoxCategory / SellfoxBrand / SellfoxAttribute | — |
| reviews | 评价明细 | planned | SellfoxReview | — |

### 利润报表（/sellfox/profit）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| product_daily | 产品日利润 | live | SellfoxProductDailySnapshot | — |
| profit_daily | 按日利润（8 维） | planned | SellfoxProfitDaily | — |
| profit_monthly | 月利润 | planned | SellfoxProfitMonthly | — |
| profit_settle | 结算利润 | planned | SellfoxProfitMonthly（scope = settle） | — |

### 广告报表（/sellfox/ads）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| ads_product | 产品报表 | live | SellfoxAdsProductDaily | ads_product |
| ads_campaign | 活动报表 | live | SellfoxAdsCampaignDaily | ads_campaign |
| ads_ad_group | 广告组报表 | live | SellfoxAdsAdGroupDaily | ads_ad_group |
| ads_targeting | 投放报表 | live | SellfoxAdsTargetingDaily | ads_targeting |
| ads_placement | 广告位报表 | live | SellfoxAdsPlacementDaily | ads_placement |
| ads_search_term | 搜索词报表 | live | SellfoxAdsSearchTermDaily | ads_search_term |
| ads_entity | 管理实体树 | planned | SellfoxAdsEntity | — |
| hourly | 小时曲线 | live | SellfoxHourlyMetric | hourly |
| aba | ABA 搜索词 | planned | SellfoxAbaSearchTerm | — |

### 库存（/sellfox/inventory）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| fba | FBA 库存 | live | sellfox_inventory_current | inventory_fba |
| local | 本地仓库存 | planned | SellfoxLocalInventory | — |
| flow | 库存流水 | planned | SellfoxInventoryFlow | — |
| age | 库龄 | planned | SellfoxInventoryAge | — |
| bin | 货架位 | planned | SellfoxBin | — |

### 采购（/sellfox/purchase）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| po | 采购单 | planned | SellfoxPurchaseOrder | — |
| receipt | 采购入库单 | planned | SellfoxPurchaseReceipt | — |
| plan | 采购计划 | planned | SellfoxPurchasePlan | — |
| supplier | 供应商 | planned | SellfoxSupplier | — |
| return | 采购退货 | planned | SellfoxPurchaseReturn | — |

### 财务（/sellfox/finance）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| settlement | 结算汇总 | planned | SellfoxSettlement | — |
| receivable | 应收 | planned | SellfoxReceivable | — |
| invoice | 发票 | planned | SellfoxInvoice | — |
| payment | 资金单据 | planned | SellfoxPaymentOrder | — |

### 出入库（/sellfox/stock-ops）

| 数据集 | 标签 | 状态 | 声明表 | reader |
| --- | --- | --- | --- | --- |
| io | 其他出入库 | planned | SellfoxStockIoOrder | — |
| adjust | 库存调整 | planned | SellfoxStockAdjust | — |
| transfer | 调拨 | planned | SellfoxStockTransfer | — |
| check | 盘点 | planned | SellfoxStockCheck | — |
| assemble | 加工 / 组装 | planned | SellfoxStockAssemble | — |
| split | 拆分 | planned | SellfoxStockSplit | — |

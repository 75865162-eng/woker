# 本地真实 Amazon 联调操作与结果记录

日期：2026-11-04。基于当前未提交本地版本；不提交、不推送、不生产迁移、不部署。本文没有演示同步结果。

## 当前结论

**真实 Amazon 验收：未执行，未通过。** 本轮仅检查配置是否存在和是否为 loopback，不读取／显示凭证，不连接数据库或 Redis，不请求真实 Amazon。安全预检结果：本地数据库、Redis、队列驱动、加密密钥格式和登录密钥存在；单一组织／工作区开关检查未通过。loopback 不能证明不是生产端口转发，也不能证明数据库已迁移或已安全录入真实授权。需操作者确认独立环境与具体目标范围后继续。

| 类别 | 当前记录 |
| --- | --- |
| 已通过模拟测试 | 见 verification-summary.json；实际 PG／Redis／队列／Worker，Amazon transport 受控模拟 |
| 已通过真实 Amazon API 联调 | 无；没有真实请求 ID、任务 ID、Snapshot 或抽样证据 |
| 因账号角色／Marketplace 资格／授权前置条件未验证 | LWA 刷新、参与站点、Listings、FBA Inventory、Amazon 后台抽样、真实错误与限流行为 |
| 尚未实现 | 浏览器 OAuth 回调、按 SKU 限定的任务、Listings 大规模搜索分区、跨域质量生命周期、Phase 2+ |

## 1. 环境准备（操作者在本地完成）

使用独立本地 PostgreSQL 数据库及独立 Redis 实例／逻辑 DB，**不要复用自动测试容器或带 fixture 的数据库**。同一 Redis 实例必须分开 DB；中心队列名固定 amazon-sync-jobs，不能让测试／生产共用同一 Redis DB。不要使用生产 SSH 隧道、生产数据副本或生产密钥。当前 Worker 同时检查旧同步计划与到期补货计划；因此选空白专用库，不启动其他 worker，关闭旧／新自动计划，保持一个 Worker、并发 1。

在本地私有环境文件配置以下名称，不在聊天、文档或版本库中写入实际值：

| 名称 | 作用 |
| --- | --- |
| DATABASE_URL | 独立本地 PostgreSQL 连接；不得指向生产 |
| REDIS_URL | 独立本地 Redis／DB；web 和 worker 完全一致 |
| QUEUE_DRIVER | 必须为 redis |
| AUTH_SECRET | 专用本地登录会话密钥 |
| AMAZON_SP_API_ENCRYPTION_KEY | 32 字节随机值的 Base64，web／worker 一致；持久保持，不覆盖已有密钥 |
| AMAZON_SYNC_CENTER_SCOPES | JSON 二维数组，唯一一对实际 organizationId、workspaceId；不得用名称代替 ID／通配符 |
| AMAZON_SYNC_WORKER_CONCURRENCY | 1 |
| AMAZON_SYNC_WORKER_NAME / AMAZON_SYNC_WORKER_ID | 可选，用于本地心跳识别，不包含敏感信息 |
| DOTENV_CONFIG_PATH | 预检和 worker 使用的私有环境文件路径；缺省 .env |

LWA Client ID、Client Secret、Refresh Token **通过本地“店铺与授权”页面录入或更新**，加密落数据库；中心执行器从绑定授权读取，不依赖全局 AMAZON_SP_API_REFRESH_TOKEN。旧环境凭证需显式导入，不能作为多 Seller 自动 fallback。当前不需要 AWS IAM Key／SigV4／RDT；已有 AWS 签名兼容仍保留。账号登录和组织／工作区／ERP 店铺复用现有本地管理流程；不要为此开放匿名 API 或用测试登录绕过权限。

选定未跟踪的专用环境文件后，在各终端安全加载**同一份环境**。Node `--env-file` 不覆盖已有进程变量，先检查 shell 中是否存在冲突配置；Next 还会读取 .env.local 等文件，显式进程环境优先。不要将 `env`、`printenv` 或环境文件内容发送到聊天／日志。

```bash
# 以下命令均在项目根目录；环境文件仅存本地，权限设为 600。
# .env.amazon-live.local 为专用私有配置文件，须先由操作者填写。
DOTENV_CONFIG_PATH=.env.amazon-live.local node scripts/amazon-sync-live-preflight.mjs
# 仅在预检、独立库身份人工核对完成后执行：
node --env-file=.env.amazon-live.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.amazon-live.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.amazon-live.local node_modules/prisma/build/index.js generate
# 终端 A：只绑定本机；Next dev 与 build 分目录。
node --env-file=.env.amazon-live.local scripts/next-run.mjs .next-dev dev --turbopack --hostname 127.0.0.1
# 终端 B：不能与测试脚本／生产 Worker 共用资源。
node --env-file=.env.amazon-live.local node_modules/tsx/dist/cli.mjs scripts/amazon-sync-worker.ts
```

上述 migrate deploy **仅限操作者确认的专用本地库**，不是本轮已经执行的动作。未确认本地库时停止在预检。预检退出 2 表示配置不满足最小约束；退出 0 也不证明服务可用、凭证有效或真实验收通过。

## 2. 实际请求、权限和区域

| 操作 | 当前执行的请求与参数 | 资格与权限检查 |
| --- | --- | --- |
| Refresh Token 换取 access token | POST https://api.amazon.com/auth/o2/token；grant_type=refresh_token，client_id/client_secret/refresh_token | Token 必须来自同一合法 LWA 应用及该 Seller 的授权／自授权；不是 Amazon 业务写操作；不自动轮换 Refresh Token |
| 授权验证 | GET /sellers/v1/marketplaceParticipations | Sellers v1；返回可参与站点不证明 Seller ID 身份或数据域权限；角色映射需按官方操作文档和实际应用配置复核 |
| 在线商品 | GET /listings/2021-08-01/items/{sellerId}；marketplaceIds 单站点、includedData=summaries,fulfillmentAvailability、pageSize=20；后续 pageToken | Listings Items 2021-08-01，核验 Product Listing 角色及 Seller 刊登权限；不是 Catalog Items API；只存当前适配字段，不提供 FBM 数量 |
| FBA 库存 | GET /fba/inventory/v1/summaries；granularityType=Marketplace、granularityId 与 marketplaceIds 同一站点、details=true；后续 nextToken | FBA Inventory v1，核验 Amazon Fulfillment 角色和该站点 FBA 卖家资格；无 FBA 记录的空响应不证明有数据时的正确性 |

区域代码与官方 endpoint 必须一一对应：NA us-east-1 → https://sellingpartnerapi-na.amazon.com；EU eu-west-1 → https://sellingpartnerapi-eu.amazon.com；FE us-west-2 → https://sellingpartnerapi-fe.amazon.com。Marketplace 只能选择授权验证实际返回的 ID；不要把 US／CA 国家码当作 API Marketplace ID。区域、Seller ID 不能原地改换，新身份须新增授权。

官方依据：[searchListingsItems](https://developer-docs.amazon.com/sp-api/reference/searchlistingsitems)、[getInventorySummaries](https://developer-docs.amazon.com/sp-api/reference/getinventorysummaries)、[getMarketplaceParticipations](https://developer-docs.amazon.com/sp-api/reference/getmarketplaceparticipations)、[角色映射](https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api)、[LWA](https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api)。已有官方模型版本、路径／参数及 SHA256 见 Phase 0 official-model-evidence.json。本轮重取官方网页／GitHub 时网络连接被重置，**未完成本轮在线角色映射复核**；表中角色是联调核对项，不是已证实账号拥有的权限。不声称参与站点成功自动授予其他域，不写死官方 QPS／burst。

## 3. 最小范围执行顺序

1. 浏览本地 /operations；确认登录用户、organizationId、Workspace ID，设置页 Worker 心跳在线，只有选定专用环境。截图前遮盖人员及敏感商业信息。
2. 新增授权：明确 Seller ID、区域和合法凭证。点击验证参与站点，记录验证时间及目标 Marketplace ID。Seller ID 由操作者对照 Seller Central 声明，Sellers 参与站点响应并不返回可验证的 Seller ID；Inventory 没有 sellerId 参数，实际身份由 Refresh Token 决定。**绑定前必须人工核对 Token 与 Seller 的对应，系统不能独立证明该关系。**
3. 绑定同一个 ERP Seller、一个 Marketplace，分别建立 catalog 与 inventory 数据源。核对授权 ID、ERP 店铺 ID、Seller ID、Marketplace ID；不要建立启用计划，不选择其他店铺。
4. 先在在线商品对应数据源“同步此范围”只点一次；等待 Worker。此版本手动任务为**选定 Seller／Marketplace／数据域的全量快照**，不能限定几条 SKU；最多 1,000 页／50,000 原始行、每片 5 页。账户规模不适合此范围时停止，不把安全上限等同小样本。不要并发运行两域。
5. 详情核对 taskId/sourceId、数据域、分页数／记录数／尝试数、HTTP、Request ID 和日志阶段；仅 SUCCEEDED＋COMPLETED＋已发布 Snapshot 视为成功。若因搜索结果截断（numberOfResults 大于抓取总数）失败，保留失败记录，不手工改状态或发布不完整快照；后续另行评审分区查询方案。分页不是 Amazon 一致性时间点快照，联调期间数据变化可能导致需重试或对账。
6. 打开“查看本次快照”，核对 Seller／Marketplace、当前版本和分页。抽取至少 3 个实际 SKU（不足则全部），在 Seller Central 同一站点对照 ASIN／SKU／刊登状态／履约渠道；页面和 API 的总数一致；有多页数据时核对首尾页。只有一页则多页真实路径记“未验证”，不得用模拟多页抵替。
7. 上一域完成后单独执行 FBA 库存。按 SKU＋condition 抽核可售、预留、不可售及在途分项，记录后台观察时间／时区与 API 采集时间；在途分项不是货件明细。若仅返回 0 行，记录“真实空快照链路”，非零库存抽核仍待验证。
8. 刷新页面／关闭再打开，确认任务与快照已持久化。需要验证 Token 到期刷新时，保留合法授权，稍后手动再次验证；不可输出 access token 或以后台任务成功猜测验证了到期刷新。
9. 停止前保持所有计划停用。取消／等待活动任务完成后 Ctrl-C 停止专用 Worker；保留专用库证据，不删除历史或回滚数据库，不启动生产。

## 4. 错误、恢复与隔离验收

| 场景 | 安全验证与预期 | 当前证据 |
| --- | --- | --- |
| Refresh Token 更新 | 页面更新提升 revision，清除参与站点验证；重新验证后才能执行。旧 revision 活动任务不能发布 | 模拟数据库集成已覆盖；真实待执行 |
| LWA 授权失效 | 400 invalid_grant/invalid_client/unauthorized_client，或 401/403 → AUTH_REJECTED／ERROR；无自动重试，修复凭证后重新验证 | 本轮修复＋模拟验证；不撤销真实账号来制造错误 |
| 数据域权限不足 | 请求 401/403 → 任务失败，旧快照保留；参与站点可能仍有效，不能一律解释为 Refresh Token 失效 | 只在自然出现或专用缺权授权下记录真实证据；禁止改真实应用角色制造错误 |
| 429／5xx／网络 | Worker 有界指数退避＋抖动，Retry-After 至多 1h；可用 rate-limit 头进入预算。默认缺头保守等待；请求超时 30s。自动重试从已提交页恢复，失败手动重试完整快照 | 模拟已验证；禁止对真实 Amazon 高频请求制造 429。网络注入仅在隔离模拟测试进行，真实错误若未自然出现记未验证 |
| 跨 Workspace／组织读取 | 使用另一个合法但无目标归属的本地会话，查询原 taskId／snapshot；应 403／404，无行数据 | 模拟已验证；实际登录权限真实路径待验证 |
| 跨 Seller | 同一 Workspace 有权看两个 Seller 的用户可读取两者；选 Seller B 不得返回 A 的列表，A 的任务／Snapshot 不能被标为 B，也不能替换 sourceId 执行 A 授权 | 单 Seller 真实联调不能证明双真实 Seller 路径；保留模拟证据，第二真实 Seller 后续验证 |
| 重复／中断 | 活动范围去重、授权 revision 检查、lease/fence 防止旧任务发布；完整分页才发布 | 模拟已验证；不擅自杀共享服务。真实专用进程中断演练另记 |

LWA access token 仅在 client 内存缓存；Worker 每片新建 client，因此可能每片刷新 LWA，不会将 Refresh Token 自动更换。授权验证 API 为交互请求，不自动循环重试；临时错误保留此前有效状态并标安全错误码，可稍后手动重试。任务中的域级授权失败不自动把全部域授权判失效。

## 5. 真实结果填写模板

以下字段全部待执行填写，不能用 fixture 替代。不要记录凭证、分页 Token、原始响应或买家信息。

- 操作者／复核人、执行起止时间及时区：待填写
- 本地地址／代码版本（未提交差异）／独立库身份人工确认／Redis DB 人工确认：待填写
- organizationId／workspaceId／ERP sellerAccountId／Amazon Seller ID／Marketplace ID／region／authorizationId：待填写
- 官方角色映射复核日期／应用已获角色／授权资格：待填写

| 检查项 | 类别（模拟通过／真实通过／前置条件不足／尚未实现） | HTTP／安全错误码／Request ID | taskId／sourceId／Snapshot 版本 | 页数／处理／插入／跳过数 | 抽核证据与时间 | 结果／问题 |
| --- | --- | --- | --- | --- | --- | --- |
| LWA 刷新与参与站点 | 待执行 | 待填写 | 不适用／待填写 | 不适用 | 待填写 | 未验证 |
| Listings | 待执行 | 待填写 | 待填写 | 待填写 | 待填写 | 未验证 |
| FBA Inventory | 待执行 | 待填写 | 待填写 | 待填写 | 待填写 | 未验证 |
| 更新凭证与重新授权 | 待执行 | 待填写 | 待填写 | 不适用 | 待填写 | 未验证 |
| 自然出现的权限／限流／网络错误与恢复 | 待执行 | 待填写 | 待填写 | 待填写 | 待填写 | 未验证 |
| 跨 Workspace／Seller | 待执行 | 待填写 | 待填写 | 不适用 | 待填写 | 单 Seller 无法证明双真实 Seller |

每个域只有真实 API 成功、范围正确、分页完整、已发布 Snapshot、页面可读且抽核一致，才能填“真实通过”。失败和前置条件不足分别记录，不掩盖。下一阶段先完成上述双域真实证据与容量观察，再决定是否启用低频计划／第二 Seller；不提前扩展 Phase 2。

## 本轮发现与修复／回退

- LWA HTTP 400 的 invalid_grant／invalid_client／unauthorized_client 此前仅记 API 拒绝，可能保留旧 CONFIGURED 状态；现标记 AUTH_REJECTED／ERROR，新任务阻断，不自动重试。域级 403 与全局 LWA 失效继续区分。
- LWA 短有效期 Token 此前被延长为至少 120 秒缓存；现严格使用 Amazon expires_in，空 Token／非有限正有效期不接受，60 秒提前刷新策略保留。
- Listings 末页 numberOfResults 大于累计抓取量时不再允许完整发布。该保护不能替代 Amazon 后台对账或大规模分区实现。
- 无新数据库迁移、依赖、环境写入或 API 参数变更。回退只撤销本轮代码／脚本差异，保留已有数据库扩展；已有环境开关与凭证保持不变。此次修复经模拟测试，不标记真实验证。

本轮验证：`npm run check:fast` 674／674（全量 TypeScript、lint 0 错误／4 条既有警告），独立预检测试 2／2，真实一次性 PostgreSQL／Redis／BullMQ／浏览器集成 16／16（Amazon 模拟，包含失效授权阻断和截断不发布）；之后短 Token 缓存修复由新增单测和 check:fast 验证。diff 检查通过。未改构建链／依赖／schema，本轮不重复完整构建；生产验收、真实错误及真实多 Seller 均未通过。

## 后续本地环境实测更新

专用本地环境现已实际建立并检查，先前预检未通过的单一范围问题已解决。当前实测状态、完整应用登录／授权页／心跳证据及准确操作见 [local-environment.md](local-environment.md)、[local-environment-result.json](local-environment-result.json)。授权仍待用户本地录入；真实 Amazon 验收仍未执行，不改变此前模拟／真实分类。

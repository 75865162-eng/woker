# Lili 合并页面与功能审计、工具配置补回

日期：2026-11-06（北京时间）。来源目录：`/Users/chenjieliang/Documents/lili`；目标仓库：`/Users/chenjieliang/Documents/amazon ad bulk operation`。

用户在本会话批准“补回”卖家精灵／西柚配置，并要求审计其他页面。此次实施仅补回配置页及相关接口、测试和文档。没有因此导入旧凭证、修改真实配置、请求真实 provider、迁移数据库、提交／推送或部署。其他功能缺口只登记，不批量恢复旧全局存储或跨库直读。

## 审计口径

- 实际枚举原目录 18 个 `page.tsx`、3 个 `v2/**/route.ts` 内容入口、22 个 `api/**/route.ts`；另核对 Shell 中反馈、支持、语言切换和 MCP 安装入口。
- 对照页面组件、API 和执行器源码判断能力；“有页面”“保留工具定义”“有可执行 adapter”“真实环境连接成功”分别记录，不能相互替代。
- 来源 `data/skills.json`、`tools.json`、`taxonomy.json`、`workflows-en.json` 与目标 `src/data/lili/` 对应文件逐字节一致。当前保留 116 个技能、107 个工具定义、12 个工作流；单测另核对全部技能正文可读取。课程在另一个已记录任务中按用户要求删除，不计为本次漏迁。
- 未查询旧业务库、旧配置密文或主系统真实数据库。本报告不能证明旧配置值、反馈、历史调用、余额或审批记录仍然存在，也不能证明外部服务可用。
- 审计期间工作区已有“课程删除”和“导航入口精简”并行改动，依据 `docs/lili-integration-delivery-2026-11-06.md` 相应章节保留其结果：课程地址返回 404；团队、设置、帮助只隐藏 Lili 导航，兼容地址保留。本次不恢复这些明确删除项。

## 18 个页面逐项去向

来源表中的路径均相对原 `src/app/`；目标路径以 `/lili` 为前缀。

| 原页面源码／地址 | 当前去向与状态 | 差异／处置 |
| --- | --- | --- |
| `page.tsx`，`/` | `/lili` 原生开始页 | 原版跳到开始页；目标直接渲染。无入口丢失。 |
| `login/page.tsx`，`/login` | `/lili/login` 由主系统登录承接 | 不保留仅设置 `dby_session=sandbox` 的独立登录。属于认证边界调整。 |
| `v2/start/page.tsx` | `/lili/v2/start` | 从三步连接向导变成主系统入口说明；原店铺／广告／AI 连接表单与客户端安装引导缩减，见 P2。 |
| `v2/skills/page.tsx` | `/lili/v2/skills` | 技能搜索、分类、展开、提示词保留；116 个定义完整。 |
| `v2/lab/skills/[slug]/page.tsx` | 原地址兼容，渲染技能详情 | 正文、提示词、相关工具／工作流保留；原独立数据库不再是技能目录依赖。 |
| `v2/cases/page.tsx` | `/lili/v2/cases` | 12 个工作流模板、分类、提示词和详情保留。 |
| `v2/lab/cases/[slug]/page.tsx` | 原地址兼容，渲染工作流详情 | 步骤与提示词保留；原 `fills`“开始前要填的”独立区块没有保留，P2。 |
| `v2/courses/page.tsx` | 404 | 已记录的用户主动删除，非漏迁；不恢复。 |
| `v2/courses/[slug]/page.tsx` | 404 | 同上，5 门课程与日历／报名提示一并删除。 |
| `v2/tools/page.tsx` | `/lili/v2/tools` | 107 个定义可搜索与分类；仅 3 个静态目录工具可运行，104 个业务定义标记 unmapped。不能当作执行能力完整迁移。 |
| `v2/tools/[name]/page.tsx` | `/lili/v2/tools/[name]` | 参数表单、说明、结果和错误反馈保留；原最近 5 次调用列表未迁移。provider 和 Sellfox 适配缺口见 P1。 |
| `v2/workflows/page.tsx` | `/lili/v2/workflows` | 保留 12 个工作流定义目录。原版也未接通真实报告执行器。 |
| `v2/workflows/[slug]/page.tsx` | 原地址保留 | 明确展示执行器未接入，运行返回 501。属于原版就有限制，不算新增回退。 |
| `v2/tool-config/page.tsx` | **本次恢复原生 `/lili/v2/tool-config`** | 卖家精灵内联表单共用主系统接口；西柚恢复加密保存、脱敏回显与独立初始化测试。另两项 provider 见 P2。 |
| `v2/team/page.tsx` | `/accounts` | 原团队 API 本来返回 501；主系统账号管理承接。旧成员资料未导入，导航按另项要求隐藏。 |
| `v2/settings/page.tsx` | `/settings` | 原页只有 Shopify 配置界面，其 OAuth 本来返回 501；主系统设置没有等价 Shopify 状态说明，P2。导航按另项要求隐藏。 |
| `v2/approvals/page.tsx` | 主 Agent／编排／PPC 审批入口说明 | 原审批列表和预览未迁移；原批准 API 本来返回 501。不能用旧 ID 直接应用主系统草稿，记录迁移另审。 |
| `v2/recharge/page.tsx` | 保留不可充值说明页 | 原积分／订单显示和金额计算 UI 未保留；原支付 API 本来返回 501。旧余额与订单未迁移，不伪造恢复。 |

## 3 个内容入口

| 来源 `v2/**/route.ts` | 原行为 | 当前行为 |
| --- | --- | --- |
| `skills/[slug]` | 重定向开始页 | 展示原生技能详情，内容能力增强。 |
| `cases/[slug]` | 重定向开始页 | 展示原生工作流详情，内容能力增强。 |
| `help` | 重定向开始页 | 原生帮助说明；地址保留，导航按另项要求隐藏。 |

## 22 个 API 逐项去向

目标同时兼容 `/api/lili/*` 与 `/lili/api/*`，统一主系统认证及模块权限。

| 原 API | 原代码能力 | 当前能力／结论 |
| --- | --- | --- |
| `health` | 服务／数据源状态 | 静态目录状态；不能代替 provider 健康检查。 |
| `mcp` | 定义 RPC + 调用旧 provider／Sellfox adapter | 只执行 3 个静态目录工具；原业务适配未接续，P1。ERP 会话接口不是个人 Amazon MCP。 |
| `codex-bundle` | 技能与安装说明下载 | 116 个完整技能下载保留，按 `agents:export` 校验；不再自动附加会话型 MCP 凭证配置。 |
| `preferences` | 修改语言偏好 | 语言 Cookie 保留；部分页面／导航仍中文，P2。 |
| `tools/run` | 参数校验后调用 provider／Sellfox | 参数表单和校验保留；9+2+2 项旧适配未接续，P1。 |
| `tool-config` | 全局 `.secrets` 配置读写 | 本次西柚改为主系统租户／工作区／个人加密配置；卖家精灵 UI 共用 `/api/integrations/sellersprite`。 |
| `tool-config/mappings` | provider、远端工具、字段转换与未映射原因 | 只返回 availability 列表，原详细字段映射审计未迁移，P1。 |
| `tool-config/test` | seller REST、西柚／Lili MCP 初始化 | 本次恢复西柚初始化测试；seller 现有主系统测试仍 501；Lili provider 测试未迁移，P1/P2。 |
| `stores` | 返回 501，未授权真实 Amazon | 仍明确拒绝，去 `/operations`；非原能力丢失。 |
| `ads-profiles` | 返回 501 | 仍明确拒绝，去 `/amazon-ads`；非原能力丢失。 |
| `connections` | 返回 501，不创建伪连接 | 仍明确拒绝；非原能力丢失。 |
| `connections/[id]` | PATCH／DELETE 返回 501 | 仍明确拒绝；不凭旧连接 ID 修改主系统个人凭证。 |
| `team` | 返回 501 | 仍明确拒绝；实际账号操作进入 `/accounts`。 |
| `approvals/[id]` | 返回 501 | 仍明确拒绝；实际审批走主 Agent，不能自动迁移执行。 |
| `shopify` | POST／DELETE 返回 501 | 仍明确拒绝；旧界面状态说明缺口另列。 |
| `credits` | 返回 501，无支付 provider | 仍明确拒绝；不能称为支付功能被删除。 |
| `feedback` | 写入原独立库 `FeedbackNote` | 目标返回 501，且 Shell 反馈按钮／表单缺失：实际可用路径回退，P1。 |
| `session` | 设置／清除独立沙盒 Cookie | 主登录／退出承接；旧 API 明确拒绝，不恢复认证旁路。 |
| `workflows/pack` | 缺配置则 409；执行器未实现则 501 | 目标 501，未生成报告；原本未实现，不计新增回退。 |
| `workflows/run` | 原 `sandbox/report.ts` 明确返回 501 | 仍 501，非报告生成能力丢失。 |
| `workflows/selection-doc` | 原代码返回 501 | 仍明确拒绝，提供主系统选品入口；不自动启动选品任务。 |
| `workflows/selection-html` | 原代码返回 404，无真实报告 | 目标 501，状态码差异，仍无报告；不是既有报告被删除。 |

## 确认的缺口与优先级

### P1：已有代码能力未接续

1. **9 个卖家精灵只读 adapter**：`market_get_asin`、`market_get_reviews`、`market_list_competitors`、`market_aba_trend`、`market_find_node`、`market_find_products`、`market_mine_keywords`、`market_research_keyword`、`market_aba_keywords`。证据：原 `src/lib/tool-config/provider-executor.ts` 的 `DIRECT_SELLERSPRITE_MAPPINGS`。原代码还检查远端工具 schema，拒绝不明确字段；接续时必须保留这些限制。这里只证明适配代码存在，不证明真实凭证／端点当前可用。
2. **2 个西柚 adapter**：`market_list_xiyou_tools`、`market_query_xiyou`，原代码可列远端工具并按远端 schema 校验后调用；目前只恢复配置与初始化测试，**没有恢复业务调用**。不能把保存 Token 宣称为工具已接通。
3. **2 个 Sellfox 只读 adapter**：`meta_list_stores`、`listing_get_live`。原代码依赖独立库和旧店铺 ID。不得直接搬回跨库 SQL；需要逐字段映射到主系统已有租户隔离服务，不能恢复已废弃的商品事实源。
4. **反馈提交及入口**：原独立库可保存反馈；目标无等价反馈存储／入口。需要明确个人／组织可见范围、服务端存储和查看入口后单独实施；不能自动向客服或外部系统发送。
5. **字段映射审计／seller 连接测试**：原 `tool-config/mappings` 的映射与原因 UI 消失；现有主系统 SellerSprite POST 明确返回 501。其代码中的 REST `secret-key` 与当前 MCP transport 的鉴权实现也需专项核对，不能仅凭配置保存成功认定兼容。

### P2：界面、说明或历史显示缺口

- 工具详情“最近调用”列表、审批列表／预览、充值订单／积分显示未迁移；旧记录迁移需要来源、目标、归属与 dry-run 方案，不自动读取导入。
- 原 Lili MCP provider（`duobaoyu`）与 Sorftime 原字段表单未保留；本次在配置页保留明确状态说明。个人 Amazon MCP 的工具范围不等价于原 Lili provider，不声称完全替代；Sorftime 原版本来没有独立直连执行器。
- 开始页的店铺／Ads／AI 三步连接引导、一键 Codex MCP 安装提示词被精简；原增删连接 API 本来是 501。主系统个人 Amazon MCP 的授权范围不同，不能复制旧会话接口作为个人接入。
- 工作流演练页的“开始前要填”独立标签区没有迁入；提示词本身保留。
- Shopify 原说明界面、Shell 支持说明弹窗未迁入；原版未接通 Shopify OAuth／真实客服。
- 英文切换仍有部分中文标题、说明与导航，本次新增表单也未宣称完整英文覆盖。
- `amazon-price-tracker` 被一个工作流引用，但来源技能包本来缺正文；当前显式显示缺失，不生成虚假详情。

## 本次配置恢复实现与边界

- 路由：`src/app/lili/[[...path]]/page.tsx` 不再把工具配置重定向到设置。页面继续使用 `settings:view`，不以 `agents:view` 放行。
- UI：`src/components/lili/tool-config-view.tsx`，两张可操作配置卡，含加载／失败／重试／保存反馈。页面当前与主系统设置一致，使用默认工作区。
- SellerSprite：复用现有 `/api/integrations/sellersprite` GET／PUT 和其现有保存行为，只有一份配置。本次不迁移其已存在的存储格式，不修改其他任务正在改动的 transport；连接测试未实现的状态明确显示。
- 西柚：`src/lib/lili/tool-config*.ts`，`ExternalIntegrationSetting` 中 provider 为 `xiyou_mcp`，唯一键沿用 `organizationId + workspaceId + userId + provider`。全体西柚字段 AES-256-GCM 加密保存，复用现有服务端密钥 `AMAZON_SP_API_ENCRYPTION_KEY` 和 `seal/unseal`；AAD 绑定组织、工作区、用户、provider 与用途。缺密钥／密文损坏直接报错，不写明文、不生成／修改 `.env`。
- 西柚保存、版本记录与脱敏审计同一事务，按配置作用域串行合并；空 Token／Client Secret 保留原值。普通 DTO 只有 `hasMcpToken`／`hasClientSecret` 和 configured，不回传密钥原文或尾号。
- 权限：GET 要求 `settings:view`，保存及主动测试另要求 `settings:edit`；身份来自服务端，工作区走主系统现有校验，拒绝跨来源写入和超限 JSON。API 可接收已授权 `workspaceId`，当前 UI 不新增工作区选择器。
- 测试按钮只在保存启用后可用；编辑未保存时禁止测试。只发送固定主机的 MCP `initialize`，不调用业务工具；禁止重定向、限制响应 64 KiB 和请求 10 秒，支持 JSON／SSE，错误不回显 provider 原文。实际测试需要用户主动点击，开发验证只使用 mock transport。
- 旧 Lili `.secrets`／`.env.local` 没有读取或迁移；无新增 schema／migration／配置文件；保存不会自动启动工具、任务、worker、审批或同步。

## 验证与回滚

验证路线：相关目录／配置单测、源码 lint、全仓 TypeScript、mock 浏览器与临时 Next 路由验证；不重复生产 build 或真实数据库／provider 测试。

- `npx tsx --test tests/lili-integration.test.ts tests/lili-tool-config.test.ts`：19/19 通过。覆盖目录、身份、跨组织／工作区／用户、加密 AAD、空密钥保留、无密钥拒绝、错误脱敏、固定端点与 JSON／SSE 初始化。
- `npx playwright test --config tests/browser/lili.config.ts`：6/6 通过。两项配置从导航可达，mock 保存后密钥清空、刷新恢复、主动测试、读取／保存失败重试；保留课程删除与导航精简回归。
- `npx tsx --test tests/integration/lili-native.integration.ts`：1/1 通过。独立临时 Next app 实际 SSR 15 个地址，工具配置页不再重定向；两种配置 API 命名空间、settings 权限拒绝、2 个主系统跳转和课程 404 均核对。身份／配置存储 mock，不访问真实数据库或 provider。
- 本次修改源码与测试的定向 ESLint 通过（0 error、0 warning）。`npm run typecheck` 全仓 TypeScript 通过，包含新增浏览器／集成测试类型。
- 未运行全量 `npm run check`、生产 build、真实数据库事务集成、真实 Token 连接、旧凭证迁移或发布；没有触发真实配置写入。这些操作仍需对应环境与范围明确授权。此次源码检查不等同于真实环境连通验收。

回滚时仅撤销本次配置 UI／新模块与 API 分发、恢复原配置页重定向，并对应回退测试。不得用旧文件覆盖课程删除／导航精简等并行改动；已保存的 `xiyou_mcp` 数据保留，不删除、不自动改成旧全局文件。

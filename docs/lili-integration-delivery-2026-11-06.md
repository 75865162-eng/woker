# Lili 原生模块交付记录

日期：2026-11-06（北京时间）。对应本次会话已确认的 `docs/lili-integration-plan-2026-11-06.md`。

## 实现与入口

- `/lili` 已由主系统 Next.js 应用直接提供，`next.config.ts` 的 43123 rewrite 和 middleware 中 Lili 独立认证放行已移除。
- 主系统侧栏新增“粒粒 Lili 技能中心”，使用 `agents:view`；配置、设置、团队对应页面分别按 `settings:view`、`accounts:view` 校验，不能凭 agents 权限进入。
- 原生页面：`src/app/lili/[[...path]]/page.tsx`；目录渲染和迁入组件：`src/components/lili/`；路由、目录、输入校验、受控接口和下载：`src/lib/lili/`。
- 主接口 `/api/lili/*` 与旧 fetch 地址 `/lili/api/*` 共用同一个进程内 handler；不进行外部代理。接口调用主系统 `requireApiPermission`，不接受旧 `dby_session` 或客户端角色声明。
- 使用主系统 AppShell 和字体；原 Lili 自定义卡片/按钮/输入样式限制在 CSS module 根节点内，不改主系统全局颜色或 body 样式。

## 来源、内容与数据边界

- 从 `/Users/chenjieliang/Documents/lili` 读取源码与静态定义，原目录未修改。`src/data/lili/source-manifest.json` 记录本次所读来源文件的 SHA256；历史上游版本不能代表当前包的全部内容，未声称已与远端核对。
- 保留 116 个技能、116 份完整 Markdown、107 个工具定义、12 个中英文工作流。课程目录及全部 5 门静态课程资料已按用户要求删除（2026-11-06）。工作流步骤、中文提示词、英文提示词和工具说明均保留，未运行 seed。
- 技能全文采用按需动态导入，工具列表仅把卡片字段传给客户端，不传整份工具文档和参数 schema；不会为其他主系统页面加载全部技能正文。
- 不复制独立 Prisma client、21 个业务模型、独立数据库连接、Sellfox 直连 adapter、全局密钥文件读写器或沙盒登录实现。ProductRecord、主系统授权数据源、审批和草稿边界保持原有事实源。
- 不迁移旧 Lili 业务记录、积分、订单、历史执行、`.env`、`.secrets` 或凭证。旧本地配置的全局作用域不适合多人使用，未原样接入。
- 原源码引用 `amazon-price-tracker` 但未提供其定义；在相关工作流中明确显示“原始源码包未附此技能定义”，保留原文，不建立坏链接或编造第 117 个技能。

## 页面逐项去向

下表“来源”相对原 Lili 的 basePath，当前均位于主系统 `/lili` 前缀下。原 18 个 page.tsx 和 3 个内容 Route Handler 均有去向。

| 来源 | 当前行为 | 权限/边界 |
| --- | --- | --- |
| `/` | 原生开始页；定义数量、技能包、业务工作台入口 | agents:view；不自动读取店铺连接或创建连接 |
| `/login` | 已登录用户回到 `/lili`；未登录由主 middleware 转主系统登录 | 无独立会话或沙盒登录 |
| `/v2/start` | 原生开始页，与 `/lili` 相同 | agents:view |
| `/v2/skills` | 分类、搜索、展开、复制提示词、完整说明入口 | agents:view |
| `/v2/cases` | 工作流模板分类、复制提示词、步骤详情 | agents:view |
| `/v2/courses` | 已删除 | 返回 404，导航及开始页不再展示课程 |
| `/v2/tools` | 107 个定义可搜索、分类，逐项标示可执行性 | agents:view |
| `/v2/workflows` | 定义目录与详情入口；执行状态由主 Agent 工作台承接 | agents:view；不伪造保存/调度/运行结果 |
| `/v2/tool-config` | 原生工具配置页（2026-11-06 补回）；卖家精灵与西柚两张配置表单 | settings:view；SellerSprite 复用主系统接口；西柚加密保存及主动初始化测试要求 settings:edit，业务工具仍未接入 |
| `/v2/settings` | 站内跳转 `/settings` | settings:view |
| `/v2/team` | 站内跳转 `/accounts` | accounts:view；成员操作仍由原服务端校验 |
| `/v2/recharge` | 保留入口，明确积分/支付未接入 | agents:view；不显示伪造余额，不创建订单 |
| `/v2/approvals` | 进入主系统 Agent、编排/Launch、PPC 工作台的引导页 | agents:view；实际审批操作保留 agents:approve 及既有更严格业务闸门 |
| `/v2/tools/[name]` | 定义、参数表单、说明、结果/失败反馈 | agents:view；未迁移旧调用历史 |
| `/v2/workflows/[slug]` | 原始步骤、提示词、相关技能、执行能力检查 | agents:view；检查返回明确未映射，不启动任务 |
| `/v2/courses/[slug]` | 已删除全部课程详情与静态资料 | 返回 404 |
| `/v2/lab/skills/[slug]` | 原生技能详情，与 `/v2/skills/[slug]` 相同 | agents:view；新入口不再依赖“沙盒额外功能”开关 |
| `/v2/lab/cases/[slug]` | 原生工作流详情，与 `/v2/cases/[slug]` 相同 | agents:view |
| `/v2/skills/[slug]`（原 Route Handler） | 原生完整技能详情，不再跳回开始页 | agents:view |
| `/v2/cases/[slug]`（原 Route Handler） | 原生工作流步骤，不再跳回开始页 | agents:view |
| `/v2/help`（原 Route Handler） | 原生帮助及技能包入口 | agents:view |

## API 逐项去向

路径相对 `/api/lili`，旧 `/lili/api` 同义。所有端点先按目标模块服务端鉴权；不支持的方法返回 405，未知端点返回 404。JSON 请求在共享权限 helper 复制解析前限制为 16 KiB，保留 workspaceId 校验输入；错误不回显原始参数、凭证或连接串。

| 来源端点 | 当前能力/去向 |
| --- | --- |
| `GET health` | 返回目录数量、定义来源；businessExecutionReady=false，不把目录就绪称为业务就绪 |
| `GET/POST mcp` | ERP 会话保护的目录 RPC；initialize/tools/list/三种静态目录工具；其余 tools/call 返回 isError。不是个人 Amazon MCP 的替代 |
| `GET codex-bundle` | agents:export；下载 116 份完整技能及安装说明；不包含凭证或指向未授权服务的 MCP 自动安装配置 |
| `POST preferences` | 仅切换当前浏览器 Lili 语言 HttpOnly cookie，不写全局数据库设置 |
| `POST tools/run` | 参数校验后执行 3 个静态目录工具；其他业务工具明确 501，无业务请求或写入 |
| `GET/PUT tool-config` | 西柚配置脱敏读取／加密保存；GET settings:view，PUT settings:edit；SellerSprite 表单复用现有集成 API；不写 `.env.local` 或全局 secrets |
| `GET tool-config/mappings` | settings:view；返回目录工具逐项映射状态，不返回密钥 |
| `POST tool-config/test` | settings:edit；用户主动测试已保存西柚配置时只发送固定端点 MCP initialize；开发测试全 mock，SellerSprite 既有测试仍 501 |
| `POST team` | accounts 权限；明确未映射，去 `/accounts`，不创建成员 |
| `POST/DELETE session` | 明确未映射；登录/登出由主系统负责，不颁发独立会话 |
| `POST stores` | operations 权限；明确未映射，去 `/operations`，不自动授权/同步 |
| `POST ads-profiles` | operations 权限；明确未映射，去 `/amazon-ads` |
| `POST connections` | operations 权限；明确未映射，去 `/operations` |
| `PATCH/DELETE connections/[id]` | operations 权限；明确未映射，不修改或撤销主系统凭证 |
| `POST approvals/[id]` | agents:approve；明确未映射，去主 Agent 流程，不按旧 ID 直接应用 |
| `POST/DELETE shopify` | settings 权限；明确未映射，不触发 OAuth 或配置修改 |
| `POST credits` | 明确未映射，不创建充值订单 |
| `POST feedback` | 明确未映射，不向外部发送消息或伪造已提交 |
| `POST workflows/pack` | 明确未映射，去 `/agents`；不创建任务或报告 |
| `POST workflows/run` | 同上 |
| `POST workflows/selection-doc` | 明确未映射，指向 `/agents/market/selection`；不启动 CLI 或创建商品 |
| `GET workflows/selection-html` | 明确未映射；不生成虚构报告 |

静态目录工具为 `meta_search_skills`、`meta_load_skill`、`meta_list_workflows`；最后一项只返回模板，明确 definitionOnly=true，不冒充查询了用户保存的工作流或调度记录。

原 Lili 的 `meta_list_stores`、`listing_get_live` 曾依赖独立 SELLFOX_DATABASE_URL 及其 ID/SQL 约定；合并时没有把这种跨库直读带入主系统。目前明确未映射，主系统对应业务仍通过原页面使用。将这些旧工具名映射到现有服务的 tenant/seller/site/authorization，需要单独核实契约；本次不通过放宽权限维持表面兼容。

## 验证与未执行操作

- 全仓核心测试：`npm run check:fast` 的 test 阶段 936/936 通过。默认 lint 扫到预先存在的 `.next-amazon-live` 生成文件而失败，因此不能标记整个 check:fast 通过。
- 源码 lint：`npm run lint -- --ignore-pattern '.next-amazon-live/**'` 通过（0 error，5 个其他模块现有 warning）；未为本次任务修改 ESLint 全局配置或清理构建目录。
- 本次范围 TypeScript（新增模块、相关主文件、测试及其导入依赖）通过。全仓 tsc 执行时发现并行新增的 `src/lib/selection-research/fixture.ts:16` 存在 ObjectJson 类型错误；未擅自修改该文件，不能声称全仓类型检查通过。
- Lili、角色和认证专项 17/17 通过；覆盖目录完整性、参数/体积限制、错误脱敏、原生路径、旧会话拒绝、目标模块权限、未映射业务拒绝及技能包。
- 隔离浏览器：`node node_modules/@playwright/test/cli.js test --config tests/browser/lili.config.ts`，4/4 通过；覆盖搜索/详情、目录工具、失败恢复、缺失源定义、课程提示。所有页面/请求在隔离 handler 中验证，不访问真实账号、数据库或 provider。
- 原生 Next 验证：`node node_modules/tsx/dist/cli.mjs --test tests/integration/lili-native.integration.ts` 通过。临时目录复制实际 Lili 页面、API、middleware 与权限映射，mock ERP 身份服务，使用全新 fixture 密钥、允许列表环境和本机随机端口；16 个页面成功 SSR、3 个主系统去向及其越权拒绝、两种 API 地址、登录保护与未知详情通过，结束后清理临时应用。
- 本机现有 3017 无 cookie 只读检查：`/lili` 返回 307 到主登录；`/api/lili/health` 与 `/lili/api/health` 均返回 401。43123 无监听；未创建真实会话或读取业务数据。
- 未执行生产 build、数据库迁移/seed/导入、真实 provider 调用、服务启停、commit、push 或服务器发布。现有开发服务检测配置改动后自动更新了 `tsconfig.json` 的 dev 类型目录（`.next-amazon-live/types`）；没有为此手动启动/重启服务。

## 后续边界与回滚

- 本地合并和隔离验证不等于真实账号业务执行、上游 GitHub 同步或生产验收。现有工作区还有 Amazon Ads、schema/migration、selection-research 等其他变更，未提交或打包任何改动。
- 主系统代码已原生提供 Lili；仓库 Caddyfile 目前统一代理主应用，没有为本次修改部署配置。实际服务器运行配置未检查，发布时需核实是否仍有旧 Lili 前缀代理，不可据本地成功声称服务器已合并。
- 若后续需要旧记录/配置导入、新 provider 存储边界或真实工具映射，应提交字段/作用域/凭证/回滚方案并按仓库规则获得批准。不能直接复制旧库全局配置或用 SKU/ASIN 推测租户归属。
- 代码回滚按本次文件清单撤销新增模块及四处集成 diff，保留其他并行工作。原独立源码仍在；恢复旧代理本身不会启动 43123，也不能保证旧入口可用。没有数据迁移，因此本次不涉及数据库回滚。

## 课程删除（2026-11-06）

- 按用户要求删除本应用课程目录、所有详情、五门静态课程资料、课程日历/报名提示组件、专用弹窗状态，以及导航与开始页课程文案/计数。旧目录和详情由现有路由解析器拒绝并进入 Next.js 404。
- 来源清单和原合并方案作为历史来源证据保留，不代表当前仍提供课程。原独立来源目录未修改；本次不涉及数据库、真实业务数据或配置。
- 同步路由单测、隔离浏览器用例与集成脚本的有效页面清单；本地验证结果见本次任务回复。此前“课程提示”浏览器记录属于删除前历史结果。
- 回滚需成组恢复课程定义、组件、路由与文案；不需要数据迁移。未执行 commit、push、发布或服务重启。

## 导航入口精简（2026-11-06）

- 按用户要求从 Lili 模块导航移除“团队”“设置”“帮助”三个入口；工具配置入口保留。
- 页面定义与可见导航分开，原地址及其权限/跳转逻辑保持兼容。主系统账号管理、设置及其他模块入口不变。
- 验证：Lili 路由单测、隔离导航浏览器回归与 TypeScript；不涉及真实数据、配置、服务启停或发布。

## 工具配置补回与页面审计（2026-11-06）

- 用户批准补回卖家精灵／西柚配置，配置地址恢复原生页面，不再跳转设置。两张表单均可加载／保存／失败重试；SellerSprite 复用原集成接口，西柚复用现有集成表及服务端 AES-GCM，加密保存与版本／审计同事务。
- 西柚测试入口只发送 MCP 初始化，须先保存启用并具备 settings:edit；开发验证全 mock。未读取／迁移旧密钥，未修改真实配置，未实际请求 provider，未改变旧业务工具未接入的状态。
- 全部原 18 个页面、3 个内容入口、22 个 API 和 Shell 入口逐项审计见 `docs/lili-page-audit-2026-11-06.md`。已区分 13 项旧 adapter 未接续、反馈／调用历史等缺口、原本未实现能力，以及用户主动删除的课程／导航。
- 本轮相关单测 19/19、隔离浏览器 6/6、原生临时 Next 集成 1/1、定向 ESLint 和全仓 TypeScript 均通过；不代表真实数据库事务或 provider 连通验收。未执行 commit／push／发布，无新增 migration 或运行环境配置。

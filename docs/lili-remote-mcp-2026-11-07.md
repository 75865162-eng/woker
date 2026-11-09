# Lili 网站 MCP 配对与 Skill 交付

验收日期：2026-11-07，北京时间。仅代表本地观察，不代表生产部署。

## 实际连接与原生验收

本地入口：http://localhost:3017/api/lili/mcp 。旧 /lili/api/mcp 保持兼容。
Codex 安装版 app-server 的原生 MCP 客户端返回 connected、服务版本 1.4.0；通过原生 mcpServer/tool/call 调用 lili_ping，authenticated=true。没有用普通 HTTP 成功替代原生验收。

配对码由实际网站 Route Handler 生成、实际兑换签发设备凭证，同一码重放 401。此次以已有受限 Bearer 管理入口发起，未冒充已经过网页登录按钮验收。

五阶段 Skill 均通过原生 MCP 搜索、读取 manifest，在 ~/.codex/skills/lili-<skill_id>/SKILL.md 校验加载原文。现有同名用户 Skill 内容不同，保留原文件并安装网站缓存。缺失缓存经同一原生客户端下载、哈希校验成功，第二次只调用 manifest，没有调用 meta_load_skill。证据：acceptance/lili-native-download-2026-11-07.json。Skill 是说明，不执行代码；没有修改用户原 SOP。

真实原生 Lili 调用 amazon.stores.list → data_describe_table → data_query，读取 aoocy-us / ATVPDKIKX0DER 库存 3 行，共匹配 201 行。source=AmazonInventorySnapshot，isSandbox=false，freshness=stale。最后同步 2026-11-06T10:51:08.169Z（北京时间 18:51:08）；不是实时上游查询，也不是库存汇总。
requestId=1fda3145-7d03-4057-84a8-000f5d6a3c15。审计回读成功时间 2026-11-07T11:46:14.713Z（北京时间 19:46:14），action=amazon.mcp.tool.succeeded。仅保存摘要，不将原始业务行提交到仓库。

## 当前真实工具目录

此次只读设备发现 12 个工具：

- amazon.stores.list
- data_list_tables、data_describe_table、data_sync_status、data_query
- lili_ping
- meta_search_skills、meta_get_skill_manifest、meta_load_skill、meta_get_market_access、meta_list_workflows
- research_prepare

ERP Schema/description 来自真实注册定义，经当前个人工具授权、组织角色、工作区和店铺/站点过滤。私有研究工具需要明确 credential grant 与当前 agents 权限；此次未扩权，因此不展示。原 Skill 引用的 market_*、finance_* 不表示已接通，没有编造同名实现。

## 配置和使用

设置入口：/settings?tab=skill-erp，“AI 与 MCP → Lili MCP → 连接 Codex”。选择已有个人授权，生成 ID 和一次性密钥。缺少个人授权时沿用原凭证面板及店铺授权流程。

本机运行 python3 scripts/lili/pair-codex.py http://localhost:3017/api/lili/mcp ，输入 ID 和不回显密钥。助手只替换 ~/.codex/config.toml 的 lili 段，保留其他 MCP，原子保存并 chmod 0600。不把密钥发到聊天。

等价配置如下；实际 Token 由本机助手保存：

~~~toml
[mcp_servers.lili]
url = "http://localhost:3017/api/lili/mcp"
http_headers = { Authorization = "Bearer <仅本机保存>" }
~~~

客户端需重新加载 MCP / 开启新会话获取新目录。本次已保留同范围有效设备，未把配置留在已撤销 Token 状态；原生重验见 acceptance/lili-native-active-2026-11-07.json。

本地优先同步：node scripts/lili/skill-sync.mjs http://localhost:3017/api/lili/mcp amazon-product-research 。第四参数可指定 skills 根目录，默认 CODEX_HOME/skills 或 ~/.codex/skills。

原生重验：python3 scripts/lili/native-smoke.py --seller <已授权ERP内部店铺ID> --output <本机JSON路径> 。直接驱动已安装 Codex 原生 MCP，无模型子代理，无模拟业务响应，不包含密钥。

## 认证和回滚边界

- 已新增 OAuth 授权服务器/资源 metadata、动态客户端注册、S256 PKCE、一次性授权码、1 小时访问令牌、刷新轮换与重放撤销。旧 Bearer 配对助手保留兼容。原生 Codex OAuth 与自动刷新验收见 acceptance/lili-native-oauth-2026-11-07.json 和 lili-native-oauth-refresh-2026-11-07.json。
- 复用 AmazonMcpCredential，无新账号体系、无数据库迁移。配对记录使用现有 DISABLED、tokenPrefix=pairing、revision 计数；消费后 REVOKED。
- 验证码 256 位随机、服务端仅 SHA-256、5 分钟、一次成功、5 次错误锁定；兑换/撤销共享 PostgreSQL advisory lock 防并发重放。
- 设备独立凭证，最长 30 天且不超父凭证到期，不扩大父工具/店铺范围。每次鉴权和 ERP 数据边界检查设备/父链、用户、组织、工作区及实时授权。身份不取模型参数。
- 网站设备管理要求 settings 权限；Bearer 管理只能配对自己的精确凭证、查看/撤销其直接子设备，不能借同用户其他高权限凭证扩权。
- 现有凭证面板可 rotate/revoke，设备轮换保留父授权边界，轮换后须更新本机 Token。到期需重新配对；自动刷新未实现。
- 市场直接调用关闭，预计费用 unknown，未请求付费供应商。付费研究沿用持久化人工审批，MCP 不能自批。
- 测试设备撤销后实际 HTTP 401。原生客户端对此等待认证并超时，没有成功返回；不把超时伪称正常原生错误响应。另建同范围有效设备用于继续使用。
- 回滚仅撤回本次 Lili 改动并撤销新设备、恢复 lili 匿名配置；保留原 /api/mcp/amazon、原个人授权、用户 Skill 和业务数据。

## 实际修改文件

- src/lib/lili/api.ts、public-mcp.ts、research-bearer-mcp.ts、research-bearer-server.ts：协议版本、instructions、ERP 动态目录、认证和审计。
- src/lib/lili/device-pairing.ts、skill-manifest.ts：配对设备、原文 manifest、健康工具。
- src/lib/lili/runtime-tools.ts、tool-execution.ts、skill-bundle.ts：公共技能注册、加载及安装说明。
- src/lib/amazon-sync/mcp.ts、data-access.ts：设备父授权边界、轮换和即时撤销。
- src/app/api/lili/devices/route.ts、pair/route.ts、middleware.ts：受保护管理和精确匿名兑换分流。
- src/components/settings/lili-devices-panel.tsx、skill-erp-settings-panel.tsx：生成/查看/撤销设备 UI。
- scripts/lili/pair-codex.py、native-smoke.py、skill-cache.mjs、skill-cache.d.mts、skill-sync.mjs：本机配对、原生验收、来源/哈希/缓存校验。
- tests/lili-public-mcp.test.ts、lili-research-bearer.test.ts、lili-runtime-tools.test.ts、lili-skill-cache.test.ts、tests/integration/amazon-mcp.integration.ts。
- 本文及 docs/acceptance/lili-*.json。

部分文件已有未提交改动，本次基于现状扩展，没有覆盖其他任务。完整工作区还包含品牌分析、报表及选品研究等改动，未做局部提交来宣称全区已同步。

## 验证与未完成

Lili 专项 52/52；隔离 PostgreSQL/Redis 实际集成 44/44，覆盖重放、过期、错误锁定、撤销、父撤销、跨用户/组织/工作区/店铺/站点、无写/市场授权与研究所有权。Fixture 只作安全回归，不冒充真实验收。

check:fast 全量测试 1178/1178、lint 0 errors（7 条已有 warning）。该次 TypeScript 被并行变动的品牌采集脚本 nullable 错误阻断；该脚本随后变动修正后，独立 npm run typecheck 通过。本次未修改该无关脚本。定向 ESLint、git diff --check 通过。未运行完整生产构建，合码/发布前需全区 check。

尚未完成：

1. 未确定唯一正式 HTTPS 域名，也未部署服务器/TLS/DNS。https://正式网站域名/api/lili/mcp 仅为目标格式；旧 aecob.com 和新 IP 是不同环境，不能把本地验收写成公网验收。
2. 浏览器处未登录页，真实网页按钮和一次性展示的交互验收未完成；后端生成/兑换与原生认证已真实执行。
3. OAuth S256/PKCE、刷新轮换与重放撤销已实现并完成本地原生验收（见下文 OAuth 增量）；正式 HTTPS 仍未验收。
4. Skill 使用 sha256 内容版本，原资料没有更新时间，updated_at=null 并标明未知；完整语义版本发布历史及跨文件包依赖未实现。
5. 原研究工作流已有 AgentExecution/Skill 快照/证据/阶段/审批和 FileObject HTML；本次未真实执行五阶段付费研究，也不将匿名 stage 0 当持久化。市场工具未实现有权设备动态直连，仍经研究审批。
6. 未收到可读取的《多宝鱼 MCP 技能工具完整说明》附件，依据用户设计点及真实目录实现，不假定其源码。
7. 没有 commit/push/部署。完整工作区含其他未完成改动，未声称两端同步；桌面追溯只在实际成功 commit/push 后触发，本次不伪造记录。

本机另安装 lili-website-connect 操作 Skill，指导新会话先检查 manifest、命中本地再加载，保留用户 SOP。Skill 同步需要 Codex 按此说明执行；没有安装后台自动更新进程。

## OAuth 增量（2026-11-07）

- 本地已应用并登记迁移 20261107030000_lili_oauth，只创建三个 OAuth 哈希/元数据表，不迁移业务数据。其他环境须按现有 CI 流程应用；本次未部署生产。
- Codex 的 mcp_servers.lili 只配置 url，执行 codex mcp login lili，在授权页输入网站生成的一次性码。正式令牌由 Codex OAuth 存储管理，不再放在此配置的 Authorization 中。
- 生产必须设置 LILI_PUBLIC_ORIGIN 为实际 HTTPS origin；目前未确认和发布正式网站域名。
- OAuth 访问令牌 1 小时；刷新有效期不超过父凭证与 30 天。每次刷新复核权限；刷新重放撤销整个设备。OAuth 令牌不能用于 /api/mcp/amazon。
- 原生验收使用已安装 Codex app-server 的 OAuth login 与 MCP tools/call。自动刷新验收仅使本次测试设备 access token 过期，然后由 Codex 自行刷新；没有读取或输出 OAuth 存储中的密钥。
- 回滚应用代码可继续使用旧 Bearer 路径；保留新表，不执行删除数据回滚。未关联 OAuth grant 的旧凭证继续兼容。

## 当前 Codex 推理执行（本地增量）

MCP research_start 固定 executionMode=codex，不读取或调用网站模型；旧网页 server 任务兼容保留。research_read 返回当前 Skill、真实工具 Schema、保存证据与运行 revision。Codex 通过 research_step 的 action 和 expectedRevision 提交下一动作，服务端仍执行原有 Schema、证据、预算、权限及人工门禁；旧 revision 拒绝，已批准请求不能由新 action 替换。无 action 只运行 Skill 初始化或精确获批请求，不回退网站模型。页面批准后的自动推进在 Codex 任务只执行一步，避免继续请求缺失的客户端动作。登录跳转保留研究任务参数。

本地原生任务与审批证据见 acceptance/lili-codex-native-run.json 和 lili-codex-native-market-gate.json；首个市场请求仍待网站真实审批，不表示市场闭环已完成。测试设备撤销原生验收见 acceptance/lili-research-native-revocation.json。未部署生产。

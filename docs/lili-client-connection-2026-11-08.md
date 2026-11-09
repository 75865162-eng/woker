# Lili 客户端连接指引

范围：本地连接面板与纯函数，不改变 MCP API、OAuth、凭证、数据库模型、权限或生产部署。

设置入口 `/settings?tab=skill-erp` 的 Lili 面板现在展示从当前浏览器 origin 生成的完整 `/api/lili/mcp` 地址、可复制 Codex TOML、OAuth 登录命令和新会话验收指令。拒绝带凭证、query、fragment 或非根路径的 origin；HTTP 仅允许 loopback。不能将其他网站的带密钥链接作为本站 Lili 地址。

连接验收分三层：网站服务在线、客户端原生 MCP 连接成功、目标聊天实际拿到工具。网页不能读取另一客户端的工具列表；普通 HTTP 成功不能证明第三层完成。最终需目标聊天真实调用 `lili_ping`，并核对 `authenticated=true`。

2026-11-08 本地检查：Codex 已配置 `http://localhost:3017/api/lili/mcp`，但检查时 3017 无监听且 HTTP 连接失败；不是凭此认定 OAuth 已失效。不得把历史验收结果当作本次实时状态。

回滚：仅撤回本次连接指引组件增量、`client-connection.ts` 及对应测试/本文。现有配对、撤销和 OAuth 逻辑保持原边界。不包含远程发布或真实配置自动改写。

## 本次验证与交接

- 连接指引、公共 MCP、OAuth 专项单测 11/11 通过；全仓 TypeScript 与本次三个源码/测试文件的定向 ESLint 通过。
- 独立浏览器打包通过；Playwright 临时隔离页面拦截所有网络，以 mock 设备/凭证验证地址展示、步骤展开、复制 TOML 与故障说明，未发出写请求或访问真实服务。
- 本次为连接 UI/纯函数增量，未运行全仓 check:fast、生产构建和生产 E2E；准备合码或发布时按全改动区范围执行更高等级验证。
- 根环境解析校验通过，当前目标为本机 PostgreSQL 127.0.0.1:55439/amazon_sync_live_local、Redis 127.0.0.1:6399/0，匹配对应现有 Docker 端口映射。未查询业务行、未修改环境、未启动 Web/Worker。
- 用户选择沿用本机现有 Lili 地址。启动 Web 的具体命令、真实连接目标与仅握手/发现/ping 范围已另行提交审批；未收到批准前不执行，也不将这次代码验证声称为真实连接验收。
- 工作区已有大量跨模块未提交改动；本次未 commit、push、部署，也未修改其他任务改动。GitHub 同步需先按全改动区规则确定范围。

## 获批后的本地连接验收（2026-11-08 14:12，北京时间）

用户明确批准启动 `npm run dev -- --hostname 127.0.0.1 --port 3017`，沿用已核实根 `.env` 的本地 PostgreSQL/Redis 目标，仅验证握手、工具发现与 `lili_ping`。Web 已启动并保留运行，监听 PID 29901；本次没有启动 Worker、执行迁移、修改真实配置或查询店铺业务行。此进程状态仅代表观察时刻，不是生产可用性证明。

- HTTP initialize 返回 200，协议 `2025-06-18`，服务 `lili-mcp` 版本 `1.4.0`。匿名目录读取成功，匿名 ping 返回 `authenticated=false`，符合认证边界。
- 使用安装的 Codex CLI `0.165.0-alpha.1.2` 的原生 app-server，以临时会话复用既有 Lili OAuth。为限定验证范围，其他 MCP 仅在该检查进程中禁用，没有改写持久配置。
- 原生 `mcpServerStatus/list` 返回 `runtimeStatus=connected`、`authStatus=oAuth`，发现 12 个工具；原生 `mcpServer/tool/call` 调用 `lili_ping` 返回 `isError=false`、`authenticated=true`。未重新配对，未人工读取或输出 OAuth 密钥。前一次原生检查超时；后续显式完成初始化通知并核对临时覆盖参数后成功，以成功回读结果为本次验收依据。
- 工具为 `amazon.stores.list`、`data_describe_table`、`data_list_tables`、`data_query`、`data_sync_status`、`lili_ping`、`meta_get_market_access`、`meta_get_skill_manifest`、`meta_list_workflows`、`meta_load_skill`、`meta_search_skills`、`research_prepare`。发现不等于已执行业务查询。
- 当前聊天工具目录仍无 Lili 工具。独立原生客户端成功不能替代本聊天工具注入验收；需客户端重新加载 MCP 后在目标聊天重新核对，必要时新建聊天。
- 本次未改源码，无需重复前述代码测试；启动后确认 `tsconfig.json`、`next-env.d.ts` 没有 Git 改动。仍未 commit、push 或部署。

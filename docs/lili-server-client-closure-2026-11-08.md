# Lili MCP 服务与 AI 调用端闭环

## 用户确认的目标

2026-11-08：Lili 是 ERP 集成的 MCP 服务，用于 AI 调用 ERP 的 Amazon 数据。用户明确不要本机常驻，后续部署到服务器常驻。本次不安装 launchd，不修改生产配置，不执行服务器部署。

## 两个独立边界

1. 服务端：当前 3017 由聊天工具启动 `npm run dev`，没有配置常驻托管。此前进程停止，确切退出原因缺少历史退出日志，不能声称已经证实是聊天结束、休眠或系统杀进程。生产应沿用 `deploy/systemd/amazon-web.service` 的 standalone 启动及 Restart 监督，让服务独立于本机和聊天生命周期；不为 MCP 新增 Worker 或重复 Next 服务。
2. AI 调用端：ERP 提供 `/api/lili/mcp`，但工具是否提供给模型由实际 AI 宿主管理。当前会话 catalog 无 Lili；独立 CLI 的配置/授权有效并不等于其他调用端已注册。单纯部署 ERP 不能改变调用端 catalog。须在实际宿主登记远程 MCP，完成该宿主的授权与工具发现；若是自建 API 中转，需要其 MCP 到模型工具的注册/转发实现。尚未定位实际宿主的配置或源代码，不虚称已修复该边界。

## 本次落地与证据

- `scripts/lili/native-smoke.py`：补齐初始化通知，初始化失败关闭检查子进程；新增 `--connection-only`，仅原生发现和 `lili_ping`，临时禁用其他 MCP，不查询 Amazon 数据、不加载 Skill、不改持久配置。
- 修正临时覆盖项的 server name 编码，按安装版 CLI 已验证的裸名称语法传参；不支持的名称安全拒绝。
- 原生专项检查成功：`connected`、`authenticated=true`、40 个工具，结果保存到本机 `/tmp/lili-connection-check-20261108-fixed.json`；明确 `targetChatToolsVerified=false`。这是本次客户端检查结果，不是服务器验收。
- 设置页补充 ERP 服务/AI 调用端的责任说明，不改变权限、API、存储和数据访问。

## 服务器发布的必要条件

- 先确定唯一正式 HTTPS 域名和目标环境。仓库新服务器入口是 HTTP IP，不能原样作为现有 OAuth 的正式远程入口；`liliOAuthOrigin` 拒绝非 loopback HTTP，且生产需要 `LILI_PUBLIC_ORIGIN` 为正式 HTTPS origin。Caddy 当前文件含多个旧新目标，不能未经确认直接套用。
- 使用现有 CI artifact、deployment-plan 和 systemd 发布边界，校验改动区全范围、基线 SHA、构建与所需迁移。OAuth 表须在目标库具备；是否需要迁移以目标环境只读盘点为准。不要因发布 MCP 默认重启全部 Worker 或更新 infra。
- 本地和服务器数据/凭证独立，切换 origin 后应在目标环境授权；不复制本地 OAuth 密钥，不自动迁移本地 Amazon 数据，不把新空库服务器当作旧环境同一数据集。部署代码不代表服务器已有 Amazon 授权、同步数据或上游实时查询能力。
- AI 调用端登记正式 MCP 地址，按其能力使用 OAuth/受控凭证，不把密钥嵌入示例或聊天。重新发现实际授权工具，再由实际 AI 发起 `lili_ping` 和获批只读查询。
- 验收分别记录 HTTPS/metadata、原生认证、实际 AI 工具发现/调用、组织工作区店铺隔离、访问令牌刷新及服务监督状态；不能以服务端 200 或 CLI 成功代替最后一段。

## 回滚与未完成

本次脚本/UI 改动可逐文件撤回；没有安装运行配置。未来发布回滚沿 deployment-plan 和历史 release，还原所改代理/环境设置；不删 OAuth/业务数据表。客户端连接可恢复原入口，凭证按原环境管理。服务器域名/目标与实际 AI 宿主注册仍待落定，故两个根因尚未宣称完成。

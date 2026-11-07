# 执行状态

- [x] 确认本地原生 Lili 与业务 MCP 地址不同，当前客户端没有 ERP 工具。
- [x] 取得精确入口修复批准，保留其他认证入口。
- [x] 添加 middleware 回归、Route Handler 隔离链路和停用/断连测试。
- [x] 修复隔离测试已有迁移清单遗漏。
- [x] registry/datasets/middleware 12/12，SP MCP 隔离 42/42，Ads MCP 离线 14/14。
- [x] 定向 ESLint 与全项目 TypeScript 通过。
- [x] 仓库 Skill-ERP 完成且 quick_validate 通过。
- [x] 提供单店 US 只读授权及客户端脱敏配置方案。
- [x] 获得真实授权、凭证和 Codex 配置变更批准。
- [x] 原 ERP 审批流程应用 US 查看及 MCP 授权；创建并回读五个只读工具凭证。
- [x] 新增并回读本机 erp MCP 服务项（环境变量方式）；密钥待用户受控保存与注入。
- [ ] 客户端实际发现 ERP MCP 工具。
- [x] 使用当前个人 Bearer 完成真实 HTTP MCP initialize/tools/list，以及单店单站点前三条库存查询；此为协议链路验证，未代替原生对话工具验收。
- [ ] 对话真实 MCP 查询非空库存，核对来源、时间、店铺和调用记录。

交接与配置：[连接交付](../../docs/codex-erp-mcp-local-connection.md)。

# AI / MCP / ERP 协作升级：第四批交付与交接

日期：2026-11-06。范围：C08–C09 本地离线实现与验证。用户已批准设置页目录驱动、脱敏审计metadata扩展和筛选。本批不包含真实API、真实配置、持久数据库迁移、commit/push或部署。

## 实现

- 设置页移除了静态的“工具已实现”与未暴露工具规划标签。`amazon-mcp-panel.tsx` 消费管理API返回的注册目录，按工具显示只读/审批申请模式、版本、所需权限、input/output Schema、注册实现状态，以及基于现有同步状态/数据表得出的可用性和来源状态。发现目录与实际调用授权仍由服务端分别校验。
- MCP调用记录展示已有脱敏metadata中的工具版本、Gateway状态、失败分类、耗时和requestId；历史记录缺少这些字段时显示历史/未分类/未记录等兼容文本。设置页增加失败分类过滤，服务端只接受固定分类白名单。
- 成功、调用拒绝/执行异常、Gateway Schema/输出Schema/超时/取消分别写入原有 `amazon.mcp.tool.succeeded` / `amazon.mcp.tool.denied` 审计动作的JSON metadata。字段为 `toolVersion`、`gatewayStatus`、`failureClass`、`durationMs`、`requestId`；现有 `reason` 继续使用稳定分类码。安全metadata提取仍采用字段白名单，不扩展到原始参数或响应。
- 管理快照按metadata.failureClass筛选，沿用原用户、组织、工作区、卖家授权约束和分页，不增表、不改审计动作、不改历史记录。

## 验证

| 检查 | 结果 |
| --- | --- |
| `node scripts/test-amazon-sync-integration.mjs --mcp` | 40/40通过；含成功审计、Schema失败分类与筛选、敏感凭证不出日志、撤权及来源范围复核。 |
| MCP设置页隔离浏览器用例 | 4/4通过；覆盖目录驱动展示、空/非法目录、凭证生命周期和审计metadata可见性。 |
| `npm run test` | 909/909通过。 |
| `npm run typecheck` | 通过。 |
| 全仓 lint（忽略 `.next-amazon-live/**`） | 0 errors、5条既有warning。 |
| 定向 ESLint | 通过。 |
| `git diff --check` 与 `git diff --cached --check` | 均通过。 |

错误分类映射已接线到权限拒绝、参数校验、输入/输出Schema、TIMEOUT、CANCELLED、Gateway配置和执行异常；本批集成测试只直接触发并断言成功及输入Schema失败分类。超时、取消、执行异常的持久审计记录需要增加独立负例，当前不得视为逐类集成验收完成。

聚合命令 `npm run test:amazon-sync:integration` 的同步中心部分有14项通过、2项失败：`amazon-sync-center.integration.ts` 的连接错误断言未出现 `AUTH_REJECTED`，以及真实浏览器测试等待旧文案“业务同步配置（基础连接无需填写）”超时。这两项位于并行的同步中心行为，不属于 MCP 设置面板。本批对应 `--mcp` 和 MCP 面板浏览器用例均通过，没有改动同步中心行为来绕过失败。

## 回滚与剩余事项

可以回滚注册目录展示、调用记录字段展示/失败分类筛选，以及新增审计metadata字段写入。不要移除已有MCP授权检查、审计动作、日志分页/隔离边界或删改历史审计行。本批无schema migration和外部副作用。

C08本地实现完成。C09字段写入、脱敏提取和失败分类筛选完成；超时、取消及执行异常的专门持久审计负例仍待补齐。C06底层Prisma/网络物理取消、生产性能验收、C10其他ERP模块逐域审计与C11端到端闭环仍未完成。未运行生产构建或完整浏览器套件；当前代码/API改动由隔离MCP集成、相关浏览器用例、全量核心测试、lint和TypeScript覆盖，合码/上线前再运行完整检查闭环。

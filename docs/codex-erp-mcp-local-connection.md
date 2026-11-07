# Codex → 本地 ERP MCP 连接交付

核对日期：2026-11-07。本文记录本地观察，不代表服务器部署或持续可用。

## 当前结论

- ERP 新原生页面：`http://localhost:3017/lili`。
- 业务 MCP：`http://localhost:3017/api/mcp/amazon`，POST Streamable HTTP JSON-RPC，个人 Bearer 凭证认证；不是 `/lili/api/mcp` 的目录接口。
- 当前 Codex 的旧 `lili` 指向服务器 `/lili/api/mcp`，没有 ERP Bearer；本次对话没有发现 ERP、卖家精灵或西柚 MCP 工具。
- 已登录本地账号“超级 / owner”，工作区“Amazon 专用本地联调”。设置页显示无 MCP 可用范围、尚无个人凭证。店铺授权页显示 `aoocy-us` 已配置，授权运营 0 人；owner 网页访问不等于显式 MCP 权限。
- US 站点为 `ATVPDKIKX0DER`。网页已有业务数据不等于 MCP 读数验收成功；本次真实 MCP 验收仍未完成。

## 已批准并实施的本地修复

仅让精确 `/api/mcp/amazon` 通过 Cookie middleware，随后由原 Route Handler 必须执行的 Bearer 认证处理。无 Cookie 的相邻路径仍拒绝，其他登录入口不变。回滚为撤回 middleware 的精确路径分流。

新增 middleware 回归与 middleware → Route Handler → 隔离数据库测试；覆盖无效 Token、无 Cookie 发现/查询、用户停用、Seller 停用、SP 授权断连。既有隔离测试覆盖凭证撤销、跨组织/工作区/店铺/站点和 Ads Profile 隔离。

隔离 SP 测试迁移清单补入仓库已有 `20261106040000_amazon_ads_advertiser_account_id`，仅供脚本新建的临时测试库，未对真实库迁移。

## 待批准的最小真实连接方案

1. 在当前本地工作区“店铺与授权 → 成员及角色数据范围授权”，选择当前账号“超级”和 `aoocy-us`，Marketplace 明确填写 `ATVPDKIKX0DER`（不可留空，留空会覆盖全部绑定站点）。只启用“查看”和“允许 MCP”，关闭同步、导出和修改。提交审批，核对相同范围后批准并应用。复用已有验证和绑定；如绑定缺失或身份未验证，停止并重新说明所需范围，不调用 Amazon API 验证。
2. 在“设置 → Skill / ERP”创建 `codex-erp-us-readonly` 个人凭证，只选择该店铺 US，工具限 `amazon.stores.list`、`data_list_tables`、`data_describe_table`、`data_sync_status`、`data_query`。现有 UI 到期时间为创建后 30 天。不含 Ads、同步或导出。密钥仅显示一次，用户在本机受控配置中保存，不发送到对话。
3. 新增独立 Codex MCP 服务 `erp`，保留其他服务配置。不要给旧服务器 Lili 填入本地 ERP 密钥。推荐使用环境变量方式：

   ```toml
   [mcp_servers.erp]
   url = "http://localhost:3017/api/mcp/amazon"
   bearer_token_env_var = "ERP_MCP_TOKEN"
   ```

   本机 CLI 已核实对应命令：`codex mcp add erp --url http://localhost:3017/api/mcp/amazon --bearer-token-env-var ERP_MCP_TOKEN`。此命令会写入 Codex 配置，尚未执行。使用此方式必须让实际启动的 Codex 进程继承 `ERP_MCP_TOKEN`；终端 export 不会改变已经运行的桌面进程。不要把该变量写入 ERP 根 `.env`、shell profile 或业务 Worker 配置。

   若桌面启动环境无法注入变量，可由用户在本地 Codex 配置编辑器手动设置静态头，作为上述环境变量项的替代（不要两者并存）：

   ```toml
   [mcp_servers.erp]
   url = "http://localhost:3017/api/mcp/amazon"
   http_headers = { Authorization = "Bearer <仅在本机填入实际个人凭证>" }
   ```

   全局配置位置为 `~/.codex/config.toml`。静态头含密钥，应限制为当前用户可读，不提交或上传。保存后重新加载 MCP；客户端不支持热加载时重启 Codex 并打开新对话。只有新对话实际出现工具才算发现成功。
4. 仓库 Skill 在 `.agents/skills/skill-erp/SKILL.md`，重新打开项目对话后检查是否发现；也可显式要求读取该文件。未修改全局 Skills 或下载包。
5. 在新对话提出：“用 ERP MCP 查询 aoocy-us 美国站已同步库存的前三条，说明来源、快照时间、查询时间、店铺和站点，不启动同步。”先实际调用 stores/list，再 describe inventory，最后 data_query，单店铺单站点 `pageSize: 3`。记录响应 requestId 和元数据；在 ERP Skill 调用记录核对成功条目。响应须非空且来自该范围，才完成真实读数验收。

真实连接会新增受限访问凭证，调用会更新 lastUsedAt/审计记录；不会请求 Amazon 上游同步。撤销时禁用/撤销该凭证，移除 `erp` 客户端项，按需撤回此次显式用户授权。不得通过真实账号停用或故障注入测试撤权；负向验证使用隔离 fixture。

## 验证与范围

已完成：MCP registry/datasets 单元测试 10/10，middleware 测试 2/2，Ads MCP 离线隔离 14/14，SP MCP 集成隔离 42/42；定向 ESLint、全项目 TypeScript、Skill quick_validate 均通过。集成测试直接串联 middleware 与 Route Handler，并非真实 Codex HTTP 客户端验收。针对本次认证变更使用专项隔离验证，未运行完整构建；合码/上线时再执行完整检查。真实账号没有创建/变更凭证、修改授权或配置，没有提交、推送、部署或真实数据库迁移。

尚待：真实授权及客户端配置批准、重新发现工具、真实 MCP 读数、结果与 ERP 调用记录核对。卖家精灵、西柚、跨来源建议和写回回读均尚未验收。

## 用户批准后的执行记录（2026-11-07）

用户对上述最小方案回复“授权”后，已通过原 ERP 页面提交、批准并应用当前账号对 `aoocy-us` / `ATVPDKIKX0DER` 的用户级 `view + mcpEnabled` 授权。审批状态回读为 APPLIED，未授予同步、导出或修改。

已创建 `codex-erp-us-readonly`，状态 ACTIVE，凭证详情回读仅包含该店铺 US 及上述五个只读工具。密钥仍留在本机网页的一次性展示中，未写入文档或对话；等待用户受控保存。当前页面显示库存 201 行、商品 230 行、销售 31 行可查询，其中库存已过期；这是设置页状态，不能作为 MCP 真实查询验收。

已执行 `codex mcp add erp --url http://localhost:3017/api/mcp/amazon --bearer-token-env-var ERP_MCP_TOKEN`，并解析本机 TOML 回读确认地址和变量名一致。未修改其他 MCP 项。此步骤仅添加客户端服务项，尚未向实际桌面进程提供密钥，也没有重新加载当前对话工具。

用户下一步：在网页保存一次性密钥；若不使用桌面进程环境变量，在本机 `~/.codex/config.toml` 的 `[mcp_servers.erp]` 中删除 `bearer_token_env_var` 行，改用上文的 `http_headers`，仅在本机填入密钥并保存。随后重新加载 MCP 或重启 Codex、打开项目新对话，再按上述查询提示进行真实验收。勿刷新 ERP 凭证页，直至已保存密钥。

尚未完成：实际桌面进程认证、客户端工具发现、真实 MCP 数据查询和日志核对。本轮只做批准范围的真实授权/凭证/本机客户端配置；没有启动同步、上游 Amazon 请求、部署或数据库迁移。

## 密钥保存后的协议验收

用户保存密钥后，已纠正 Authorization 缺失的 `Bearer ` 前缀，回读确认 TOML 有效、端点正确、无环境变量认证项冲突、配置仅当前用户可读。未输出密钥。

继续验收时，当前对话的实际工具清单仍没有 ERP 工具。因此通过本机脚本使用相同个人 Bearer 对业务 MCP 发起真实 JSON-RPC 请求，单独核验协议与数据链路：`initialize` 和 `tools/list` 均返回 HTTP 200，发现上述五个受限工具；随后实际调用 `amazon.stores.list`、`data_describe_table`、`data_query`，从授权发现结果选择 `aoocy-us` US，返回 3 条非 sandbox 库存记录，总匹配 201 条。

查询来源 `AmazonInventorySnapshot`，快照 `2026-11-06T10:51:01.512Z`，最后同步 `2026-11-06T10:51:08.169Z`，freshness 为 stale。查询 requestId 为 `a8b8065c-2460-491d-a973-7f9e875b51f9`，同步批次 `69f6c179-ad62-4fe4-bacc-5b5bccbd19b6`。不将前三行当作库存汇总，不保存原始业务行到本文。执行环境与客户端当前日期存在差异，查询发生时间应以该 requestId 对应的 ERP 审计记录进一步核对，快照时间按服务响应保留。

该结果证明实际 ERP MCP Bearer 认证、发现和数据库查询链路可用，**不能标为当前 Codex 对话原生 MCP 工具验收通过**。当前对话仍未挂载这些工具；尝试查看 Codex 原生应用状态被 Computer Use 工具明确禁止，未绕过限制。页面调用记录也尚未回读核对。下一步须在客户端 MCP 管理界面核对 erp 连接状态，加载到项目对话后，以原生工具完成同一查询和日志核对。没有新增凭证或授权范围，没有启动同步或上游调用。

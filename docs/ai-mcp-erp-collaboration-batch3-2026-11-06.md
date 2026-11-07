# AI / MCP / ERP 协作升级：第三批交付与交接

日期：2026-11-06。范围：C06–C07 本地离线实现与验证。用户明确批准共享Gateway扩展和审批申请验证。本批不包含真实API、真实配置、持久数据库迁移、commit/push或部署。

## 实现

- `src/lib/agent-platform/tool-gateway.ts` 增加 `invokeMcp` 独立入口。它使用 MCP 注册表声明的输入/输出Schema验证，使用单次handler执行，不读取或构造 `AgentDefinition`、Agent权限、`AgentApproval`，也不走可重试的Agent adapter循环。现有Agent `invoke` 路径保持原行为。
- Gateway为MCP调用建立独立15秒上限，将父请求取消转为子 `AbortSignal`，超时或取消时拒绝响应并忽略迟到结果；输入无效、输出不符合Schema、超时、取消有各自错误分类。MCP route将这些错误映射到安全JSON-RPC错误与requestId，不返回底层原始异常。
- `src/lib/amazon-sync/mcp.ts` 所有21个已注册handler均经该Gateway入口；handler仍在执行前后核验当前凭证、ERP授权和数据范围。Schema校验失败时只运行既有只读参数/范围预检，以保持 `FIELD_NOT_MAPPED`、页范围和越权拒绝等原错误语义。
- `src/lib/amazon-sync/mcp-tool-registry.ts` 将行查询输出Schema用于Gateway运行时验证；其它工具只声明真实顶层类型，不再虚构共同的 `data/meta` 结构。`data_sync_start` 明确要求返回 `approvalRequired:true`、`started:false` 和 `REQUESTED` 申请。
- `data_sync_start` 继续复用 `requestChange` 持久化申请，不调用批准、应用或任务启动逻辑。运行时Schema不允许响应宣称已批准或已启动。

## 取消与资源边界

Gateway保证MCP客户端在15秒预算到期或请求取消后不会收到迟到成功，并向handler发出abort signal。现有Prisma调用、部分报表读取器和外部服务并未普遍消费该signal；因此这批不能声称已物理取消正在执行的数据库/网络操作。底层数据库语句超时、驱动取消和外部请求预算仍需C06后续专项设计与隔离验证。出现超时后底层工作可能继续到自身结束，但其结果不会被Gateway返回。本限制意味着C06入口链已实现，资源取消验收尚未完成。

Gateway输入Schema校验器只覆盖本仓库注册表当前使用的JSON Schema关键字（类型、required/properties/additionalProperties、数组约束、范围、enum/const、date、anyOf/allOf、if/then、dependentRequired）。不接受远端Schema或动态 `$ref`；若将来新增未覆盖关键字，应扩展校验器和负例测试后再发布。

## 验证

| 检查 | 结果 |
| --- | --- |
| `tests/agent-platform.test.ts` | 9/9通过；包含输入/输出Schema、超时不回传迟到结果、请求取消传播，原Agent执行和审批通过。 |
| `node scripts/test-amazon-sync-integration.mjs --mcp` | 39/39通过；包括无效/越权输入的兼容错误、撤权期间抑制结果及 `data_sync_start` 仅创建REQUESTED申请且任务数不变。 |
| `node scripts/test-amazon-ads-offline.mjs --mcp` | 13/13通过。 |
| `npm run test` | 904/904通过。 |
| `npm run typecheck` | 通过。 |
| `npm run lint -- --ignore-pattern '.next-amazon-live/**'` | 通过，0 errors、5条既有warning。忽略既存生成目录；没有修改或清理该目录。 |
| `git diff --check` | 通过。 |

验证使用现有离线测试、临时数据库和mock；没有调用Amazon或其他真实外部API。完整生产构建、浏览器E2E、SQL级超时/取消压力测试和并发P95/P99未运行。Gateway同步 Schema 校验会增加有界CPU开销，尚未形成生产性能数据。

## 回滚与状态

可以单独撤回Gateway的 `invokeMcp` 入口、MCP路由接线及运行时Schema收紧；Agent原有 `invoke` 代码和批准申请实现不需回退。回滚不得移除现有实时权限检查、`requestChange`审计/revision/digest/有效期逻辑或既有授权边界。本批无数据库迁移和持久数据写入；隔离测试中的申请只存在于一次性数据库。

C07本地申请流程和离线验收完成。C06的调用Gateway、注册Schema检查、单次执行、响应超时/取消抑制完成；底层Prisma/网络操作物理取消和独立查询资源预算未完成。后续继续C06前需设计可取消的具体service/query边界；此项可能扩大共享查询模块影响，需单独列出文件、语句预算、回滚与验证范围。C08–C11仍未实施，Ads真实样本语义、生产性能和发布验收仍待原任务/后续批次完成。

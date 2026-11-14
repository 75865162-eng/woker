# Amazon MCP 与赛狐 MCP：权限隔离 + 数据隔离

结论：两个 MCP 服务已做成**物理分离的两个凭证域**，不是一个服务里的两个开关。跨提供方调用在查库前就被拒绝并记审计。

## 1. 隔离模型（四层）

| 层 | Amazon MCP | 赛狐 MCP | 越界结果 |
|---|---|---|---|
| 端点 | `POST /api/mcp/amazon` | `POST /api/mcp/sellfox`（旧路径 `/api/mcp` 为别名） | 凭证前缀不符 → 401 `PROVIDER_MISMATCH` |
| 令牌 | `amcp_` + 43 字符 | `sfmcp_` + 43 字符 | 前缀唯一，互不解析 |
| 凭证表 | `AmazonMcpCredential` | `SellfoxMcpCredential` | 无共享行，无共享哈希空间 |
| 数据域 | `Amazon*` / `SellerAccount` / `AmazonAds*` | 仅 `Sellfox*`（9 张表封闭清单） | 403 `TABLE_NOT_ALLOWED` / `DATASET_NOT_ALLOWED` |
| 数据范围 | 每次必须显式 `sellerAccountId` + `marketplaceId`，禁止 `sellerAccountIds` 跨账号 | 凭证 `storeIds` 店铺围栏，请求只能收窄不能放宽 | 403 `STORE_NOT_ALLOWED` |
| 工具 | `amazon.*` / Skill 别名，全部只读或审批申请 | `sellfox.*`（6 个工具），全部只读 | 403 `TOOL_NOT_ALLOWED` |
| 数据库角色 | `mcp_amazon_ro`（SELECT） | `mcp_sellfox_ro`（SELECT，`default_transaction_read_only=on`） | 写操作在数据库层失败 |
| 审计 | `amazon.mcp.*` | `sellfox.mcp.*` | 调用记录分命名空间，不混表 |

关键点：赛狐侧的数据范围来自**凭证行**（`organizationId` / `workspaceId` / `storeIds`），请求体只能缩小范围；Amazon 侧的数据范围来自**当前用户的 ERP 店铺分配**加显式站点选择。两者互不复用。

## 2. 配置步骤

### 2.1 环境变量（服务端，`.env`）

```bash
# 赛狐 MCP：只读连接（必须是仅能 SELECT Sellfox* 的角色）
MCP_PG_READONLY_URL=postgres://mcp_sellfox_ro:<password>@127.0.0.1:5432/amazon_bulk_ad
MCP_ORG_ID=<organizationId>
MCP_WORKSPACE_ID=default
# 可选：共享令牌的店铺围栏，逗号分隔 SellfoxStore.id；留空=全部
MCP_STORE_IDS=
# 兼容共享令牌（旧 MCP_HTTP_TOKEN）关闭开关；迁移完成后设为 true
MCP_DISABLE_SHARED_TOKEN=false

# Amazon MCP：独立只读连接（当前读路径走 Prisma，此项为纵深防御预留）
AMAZON_MCP_PG_READONLY_URL=postgres://mcp_amazon_ro:<password>@127.0.0.1:5432/amazon_bulk_ad
```

### 2.2 创建两个只读角色

```bash
cd woker
MCP_SELLFOX_RO_PASSWORD='<>=16位>' MCP_AMAZON_RO_PASSWORD='<>=16位>' npm run mcp:roles
```

脚本只做新增：建角色、收回全部权限、按表前缀授予 `SELECT`、设置 `default_transaction_read_only`。不改表结构、不删权限。输出两条 DSN，填回 `.env`。

`mcp_sellfox_ro` 只被授予 `Sellfox%` 表；即使 MCP 代码被绕过，也读不到 `Amazon*` 表。

### 2.3 创建赛狐凭证

统一入口：**系统设置 → MCP 接入**。页面自上而下：服务状态总览（在线服务 / 可用凭证 / 只读工具 / 待处理）→ 两张服务卡（地址、令牌前缀、凭证与工具数、可读数据集、最近调用，可点「测试」做连通自检）→ 隔离检查清单 → 凭证与权限表（轮换 / 停用 / 撤销）→ 新建凭证（选服务 → 选范围 → 选工具 → 生成密钥，密钥只显示一次）→ 客户端接入片段（可复制）→ 最近审计事件。Amazon 凭证在同一页面创建；旧的 Skill/ERP 标签页只保留入口链接。

或调用接口（需 `sellfox:view` / `sellfox:create` 权限）：

```bash
POST /api/operations/mcp-isolation
{
  "action": "create",
  "name": "Codex 赛狐只读",
  "tools": ["sellfox.dataset.overview", "sellfox.query_data", "sellfox.restock_suggestions"],
  "storeIds": ["<SellfoxStore.id>"],
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

`storeIds` 留空 = 该组织/工作区全部店铺。有效期最长 90 天，支持 `rotate` / `disable` / `revoke`。

Amazon 凭证仍在原入口：Skill MCP 凭证面板，有效期同样 90 天，工具和 `sellerAccountId + marketplaceId` 范围逐次校验。

### 2.4 客户端配置（两个 server 分开写）

```json
{
  "mcpServers": {
    "erp-amazon": {
      "type": "http",
      "url": "http://127.0.0.1:3000/api/mcp/amazon",
      "headers": { "Authorization": "Bearer amcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
    },
    "erp-sellfox": {
      "type": "http",
      "url": "http://127.0.0.1:3000/api/mcp/sellfox",
      "headers": { "Authorization": "Bearer sfmcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
    }
  }
}
```

不要给同一个客户端同时塞两个令牌去走同一个端点——端点本身会拒绝。需要 AI 同时看两边数据时，配两个 server，由客户端分别调用，权限仍是两套。

## 3. 验证

```bash
# 单元测试：前缀/端点/数据集/工具/店铺围栏
npx tsx --test tests/mcp-isolation.test.ts

# 真实库冒烟：建凭证→跨提供方拒绝→跨源数据集拒绝→HTTP tools/list→吊销
node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/mcp-isolation/smoke.ts
```

手工验证（应分别返回 401 与 200）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/mcp/sellfox \
  -H 'content-type: application/json' -H "authorization: Bearer amcp_<43字符>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s -X POST http://127.0.0.1:3000/api/mcp/sellfox \
  -H 'content-type: application/json' -H "authorization: Bearer sfmcp_<新密钥>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

审计查询：

```sql
SELECT action, "entityId", metadata FROM "AuditLog"
WHERE action LIKE 'sellfox.mcp.%' OR action LIKE 'amazon.mcp.%'
ORDER BY "createdAt" DESC LIMIT 50;
```

## 4. 边界与已知风险

- **兼容共享令牌**：`MCP_HTTP_TOKEN` 仍可用，身份是"共享兼容"，绑定单一 `MCP_ORG_ID`、只读、可选店铺围栏，且只作用于赛狐端点。它在隔离面板里会被标黄。迁移到个人凭证后设 `MCP_DISABLE_SHARED_TOKEN=true` 即可彻底关闭。
- **Amazon 读路径仍走 Prisma 主连接**：业务逻辑要求用户级授权与跨表快照校验，迁移到只读角色需要重写读取层。`mcp_amazon_ro` 已建好，属于纵深防御预留，不代表当前已生效。
- **旧工具名**：`query_data` / `restock_suggestions` 等保留为别名，解析到 `sellfox.*` 规范名；别名不是独立授权，勾选任一即等同规范工具。
- **`/api/mcp` 旧路径**：仍指向赛狐服务，Amazon 令牌到这里同样 401。新配置请直接用 `/api/mcp/sellfox`。
- 赛狐 MCP 不提供写入、同步触发或跨组织发现；`tools/list` 只返回该凭证授权的工具。

## 5. 代码落点

| 文件 | 作用 |
|---|---|
| `src/lib/mcp/isolation.ts` | 提供方策略、令牌解析、端点绑定、数据集/表/店铺围栏断言、隔离矩阵 |
| `src/lib/sellfox/mcp-tool-registry.ts` | 赛狐数据集与工具封闭清单、`sellfox.*` 命名空间、旧名别名 |
| `src/lib/sellfox/mcp.ts` | 凭证生命周期、认证、只读查询、审计 |
| `src/app/api/mcp/sellfox/route.ts` | 赛狐 MCP 规范端点 |
| `src/app/api/mcp/route.ts` | 旧路径别名（仍绑定赛狐） |
| `src/app/api/mcp/amazon/route.ts` | 增加跨提供方前置拒绝 |
| `src/app/api/operations/mcp-isolation/route.ts` | 状态总览、隔离检查、审计事件、连通探针与赛狐凭证管理接口 |
| `middleware.ts` | 放行 `/api/mcp/sellfox`（否则会话中间件会先返回 401） |
| `src/components/settings/mcp-settings-panel.tsx` | 设置页「MCP 接入」主面板（状态 / 权限 / 新建 / 接入 / 审计） |
| `src/components/operations/mcp-isolation-panel.tsx` | 旧隔离面板（运营中心仍引用） |
| `prisma/migrations/20261214090000_mcp_provider_isolation` | `SellfoxMcpCredential` 表 |
| `scripts/mcp-isolation/apply-roles.mjs` | 两个只读数据库角色 |
| `scripts/mcp-isolation/smoke.ts` | 隔离冒烟 |
| `tests/mcp-isolation.test.ts` | 隔离单测（11 例） |

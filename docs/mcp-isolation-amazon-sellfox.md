# Amazon MCP 与赛狐 MCP 隔离交付与数据库授权验收

仓库整改完成不等于数据库授权已实施。本文及 SQL、离线测试均不能证明真实数据库已隔离；真实 DB 待 DBA 授权执行与双连接有效权限复核属于外部阻塞。本轮未读取 `.env`、未连接真实库、未执行 DDL。

## 应用与数据库边界

| 边界 | Amazon | 赛狐 |
|---|---|---|
| 端点 | `/api/mcp/amazon` | `/api/mcp/sellfox` |
| 令牌前缀 | `amcp_` | `sfmcp_` |
| 凭证模型 | `AmazonMcpCredential` | `SellfoxMcpCredential` |
| 数据库登录 | `amazon_mcp_ro` | `sellfox_mcp_ro` |
| 只读 DSN 配置 | `AMAZON_MCP_PG_READONLY_URL` | `MCP_PG_READONLY_URL` |
| 本脚本唯一授权范围 | `public` 中 `Amazon*` 普通表/分区表 SELECT | `public` 中 `Sellfox*` 普通表/分区表 SELECT |

授权不包含 `SellerAccount`、其他业务表、视图、物化视图、外部表、序列、应用函数/过程、写入与转授权。新增表须经 DBA 再次审阅并重跑授权与审计，不授未来全部表的默认权限。应用工具封闭清单仍须独立检查；表前缀隔离不等于组织、工作区或用户的行级隔离。

`src/lib/mcp/isolation.ts` 为提供方策略来源。`src/lib/mcp/database-audit.mjs` 为 CLI、状态接口和两侧探针共享的唯一有效权限审计实现。`src/app/api/operations/mcp-isolation/route.ts` 用各自实际只读 DSN 审计，不使用主连接代验；仅配置 DSN 不显示只读检查通过。界面状态反映当次检查，仍应保留 DBA 实施记录。

## 离线交付与验收

```bash
# 只将唯一SQL输出到终端；不读取环境文件、不连接数据库、不创建或改密角色
node scripts/mcp-isolation/apply-roles.mjs

# 纯离线：假客户端、权限快照、SQL静态约束及离线入口行为
node --test tests/mcp-db-isolation.test.mjs tests/mcp-isolation-route.test.mjs
```

`npm run mcp:roles` 同样只输出 SQL。传入 `--apply` 等任何参数会退出 2，阻止误以为命令已实施授权。测试覆盖两侧正常权限、跨池与非提供方表、列级有效读取、其他 schema、视图/序列、写入、转授权、成员关系、所有权、危险角色属性、默认权限、CREATE、应用函数、缺配置及查询失败。离线测试不执行 PostgreSQL SQL，不能替代目标 PostgreSQL 版本的 DBA 演练与实测。

## DBA 人工前置步骤（尚未执行）

1. 在维护窗口备份 ACL、默认权限、角色属性与成员关系；确认变更涉及的业务连接。使用安全渠道预建两个独立 LOGIN，密码不进入脚本、版本库或终端输出。
2. 移除这两个登录的超级用户、建库、建角色、复制、绕过 RLS 属性；转移所有对象所有权；撤销其所有角色成员关系。仅设置 `NOINHERIT` 不能阻止 `SET ROLE`，不能作为替代。
3. 将 PUBLIC 的应用表/列授权迁移至明确业务角色并撤销 PUBLIC；按数据库 owner/schema 撤销对 PUBLIC 或这两个登录的默认授权。共享授权无法对单个登录做 DENY，脚本不会擅自撤销共享业务权限。
4. 清理两登录及 PUBLIC 带来的数据库 CREATE/TEMP、应用 schema CREATE、应用函数/过程 EXECUTE（含 SECURITY DEFINER）。PostgreSQL 默认 PUBLIC TEMP、函数 EXECUTE 也可能触发阻塞；先给实际需要的业务角色显式授权，再撤销共享授权。核实扩展、FDW、外部服务、其他数据库及大对象等目标环境特有入口，本文关系对象脚本不宣称覆盖所有扩展行为。
5. SQL 预检不通过会抛错，整事务回滚。DBA 必须定位并修复报错，不得删掉预检或临时绕过。脚本会撤销两登录在全部应用 schema 的表/列/序列直接权限，仅恢复本提供方普通表/分区表 SELECT；不自动修改 PUBLIC、其他业务角色或密码。
6. 在批准的目标库上由 DBA 手动运行 `psql -X -v ON_ERROR_STOP=1 -f scripts/mcp-isolation/grant-roles.sql`。所有对象引用均带 schema，执行不依赖当前业务 search_path。此步骤会变更权限，必须由外部授权流程安排。
7. 安全注入两条独立只读 DSN 至进程配置；脚本不解析 `.env`，也不输出 DSN。以实际登录运行以下只读审计，退出 0 后再保存脱敏验收证据。

```bash
node scripts/mcp-isolation/audit-roles.mjs
```

审计除目录有效权限检查外，还在 SAVEPOINT 中对另一提供方实际表执行带 schema 引号的 `SELECT 1 ... LIMIT 0`，只有 PostgreSQL `42501` 权限拒绝才认可该负向探针；SELECT 成功、其他错误或另一池无表均不能通过。该探针不读取业务行，但真实连接依然需要批准。审计使用两个实际登录各自执行 `BEGIN READ ONLY`，从 `pg_class`/`pg_namespace` 枚举所有应用关系，避免 `information_schema` 因当前权限过滤对象造成漏检。`has_table_privilege`、`has_any_column_privilege`、`has_sequence_privilege` 检查实际有效权限，因此 PUBLIC、列授权和继承带来的权限均计入；另检查角色成员关系防止潜在 SET ROLE 越权、所有权、CREATE/TEMP、函数执行与未来默认授权。

缺少任一配置、连接不可用或查询失败退出 2；身份不符、危险权限、空库或缺少本提供方 SELECT 退出 1；只有两侧均完整通过才退出 0。异常仅输出脱敏状态，不打印连接串或驱动原始错误。`default_transaction_read_only` 可由客户端修改，实际只读保证来自 ACL 验收，不能只靠该设置。

## 预检阻塞的定位与整改 SQL 模板

以下只供 DBA 审阅，在目标环境替换占位标识符；本轮未执行。PUBLIC 权限迁移前须列清实际业务角色，不能直接复制撤销命令影响在线业务。

```sql
-- 定位表与列上的 PUBLIC ACL（OID 目录不受 information_schema 可见性筛选）
SELECT n.nspname, c.relname, x.privilege_type
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
LATERAL aclexplode(c.relacl) x WHERE x.grantee = 0;
SELECT n.nspname, c.relname, a.attname, x.privilege_type
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace,
LATERAL aclexplode(a.attacl) x WHERE x.grantee = 0;
-- 先迁移原业务所需权限，再撤销共享授权；列 ACL 需要独立撤销
GRANT SELECT ON TABLE "schema_name"."table_name" TO "business_role";
REVOKE ALL PRIVILEGES ON TABLE "schema_name"."table_name" FROM PUBLIC;
REVOKE ALL PRIVILEGES ("column_name") ON TABLE "schema_name"."table_name" FROM PUBLIC;

-- 定位继承/SET ROLE 起点，再按结果逐条撤销
SELECT granted.rolname AS granted_role, member.rolname AS member_role
FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid
JOIN pg_roles member ON member.oid = m.member
WHERE member.rolname IN ('amazon_mcp_ro', 'sellfox_mcp_ro');
REVOKE "granted_role" FROM amazon_mcp_ro;
REVOKE "granted_role" FROM sellfox_mcp_ro;
ALTER ROLE amazon_mcp_ro NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS LOGIN;
ALTER ROLE sellfox_mcp_ro NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS LOGIN;
-- 对象所有权：由 DBA 按实际旧 owner/业务 owner 审核，不使用 DROP OWNED 删除对象
REASSIGN OWNED BY amazon_mcp_ro TO "business_owner";
REASSIGN OWNED BY sellfox_mcp_ro TO "business_owner";

-- CREATE/TEMP 可能来自 PUBLIC；先向必要业务角色授予对应权限
GRANT TEMPORARY ON DATABASE "database_name" TO "business_role";
REVOKE CREATE, TEMPORARY ON DATABASE "database_name" FROM PUBLIC, amazon_mcp_ro, sellfox_mcp_ro;
REVOKE CREATE ON SCHEMA "schema_name" FROM PUBLIC, amazon_mcp_ro, sellfox_mcp_ro;
-- 函数/过程使用实际签名定位，先把必要 EXECUTE 转给业务角色
GRANT EXECUTE ON ROUTINE "schema_name"."routine_name"(text) TO "business_role";
REVOKE EXECUTE ON ROUTINE "schema_name"."routine_name"(text) FROM PUBLIC, amazon_mcp_ro, sellfox_mcp_ro;

-- 定位默认 ACL；根据 owner、schema、对象类别逐项撤销，不能只改当前执行人
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl;
ALTER DEFAULT PRIVILEGES FOR ROLE "object_owner" IN SCHEMA "schema_name"
REVOKE ALL ON TABLES FROM PUBLIC, amazon_mcp_ro, sellfox_mcp_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE "object_owner" IN SCHEMA "schema_name"
REVOKE ALL ON SEQUENCES FROM PUBLIC, amazon_mcp_ro, sellfox_mcp_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE "object_owner" IN SCHEMA "schema_name"
REVOKE ALL ON FUNCTIONS FROM PUBLIC, amazon_mcp_ro, sellfox_mcp_ro;
-- defaclnamespace=0 是全局默认 ACL，需另执行不带 IN SCHEMA 的对应 REVOKE。
-- 即使 pg_default_acl 没有行，未来函数仍默认 PUBLIC EXECUTE；必须显式撤销全局默认值。
ALTER DEFAULT PRIVILEGES FOR ROLE "object_owner"
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

应用函数 EXECUTE 全部阻塞是刻意的最小权限边界：即使 SECURITY INVOKER 函数也可能带副作用；公共授权不能对单个角色拒绝。审计会报告具体函数/schema 名称，DBA 应检查签名与调用方、迁移授权再撤销，不将未知函数默认判为安全。扩展依赖无法清理时应保持未通过并记录外部阻塞。

## 工作区模型事实

`WorkspaceMembership` 以 `[organizationId, workspaceId, userId]` 为复合主键，分别通过复合外键关联 `WorkspaceScope` 和 `OrganizationMember`。统一工作区授权服务要求操作人是 active 组织成员；普通成员还必须拥有显式工作区授权，组织 owner 具有受控管理例外。Amazon Seller 授权不替代工作区成员授权。请求级去重不跨请求缓存，撤销成员授权或停用账号在下一请求重新检查。

组织 owner 可通过 `GET /api/workspaces/members?workspaceId=<id>` 查询成员；使用 `POST` / `DELETE /api/workspaces/members`，JSON 请求体 `{ "workspaceId": "<id>", "userId": "<id>" }` 授予或撤销访问。服务端在事务内重新校验 owner、目标组织成员及工作区，并写入审计。工作区列表仅返回当前成员获授权的工作区。

离线迁移 `20261218010000_workspace_membership` 只新增成员表，不隐式回填现有成员。迁移尚未在真实环境执行；启用后普通成员需要由 owner 明确授予访问，不能把本地行为测试当作真实数据库迁移或生产验收。

## 实施完成条件

必须同时具备 DBA 授权变更记录、两条生产只读连接正确配置、实际登录审计退出 0、应用级提供方/店铺/工作区授权回归结果，才能关闭数据库隔离事项。当前交付状态是仓库脚本与离线验收已提供，真实 DB 授权实施和目标环境验证仍待外部完成。

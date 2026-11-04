# Amazon 多店铺 / MCP 本地实施交付（2026-11-05）

## 交付状态与环境边界

本报告承接 `amazon-multistore-security-audit-2026-11-05.md` 与 `amazon-multistore-s0-delivery.md`。新增代码、增量 SQL、独立 PostgreSQL / Redis / 文件存储回归及浏览器回归已落地。没有连接现有业务数据库、调用真实 Amazon、修改运行配置、推送 GitHub 或部署服务器。隔离测试的 Amazon 身份和 HTTP 响应全部是明确标记的测试夹具，不能当作正式授权验收。

工作区原有大量其他未提交改动（商品域、同步中心前序阶段、文档与生成目录）。这些改动未被重置、暂存、清理或提交；上线前必须盘点整个改动区并确认同步范围。

## 阶段及文件清单

| 阶段 | 实现 / 主要文件 | 本地结论 |
| --- | --- | --- |
| 身份与店铺 | `src/lib/amazon-sync/oauth.ts`、`stores.ts`；`src/app/api/integrations/amazon/sp-api/oauth/{start,callback}/route.ts`；`src/app/api/operations/amazon-stores/route.ts`；`src/components/operations/amazon-stores-panel.tsx` | OAuth state 单次使用、10 分钟过期、绑定发起用户及工作区；官方参与站点 + 指定 Seller 的 Listings 请求验证；按 Seller / region / Marketplace 幂等建店。改名 CAS + 审计，不改身份。支持搜索、筛选、人员/权限/同步记录/审计查看；重新授权通过 OAuth，停用沿用现有审批。 |
| 数据隔离 | `data-access.ts`、`service.ts`、`processor.ts`、`read.ts`、`sales-query.ts`、`exports.ts`；S0 中 replenishment / CLI / download / published-read 修补；`src/app/api/operations/products/route.ts` | 查询直接加组织、工作区、Seller、Marketplace、成功发布 run 条件。同步创建及执行、发布前重查操作人和审批人；导出冻结 source IDs，执行/发布/下载重查。商品 SKU 分页发现查询也校验 run + Seller + Marketplace。 |
| 人员与角色 | `access-management.ts`、`approval-policy.ts`、`change-approval.ts`、`src/app/api/operations/sync-center/route.ts`、`sync-center-workbench.tsx` | 用户与角色授权并集，再与模块 RBAC 相交；view/sync/export/edit、站点和 MCP 开关。沿用密封申请、独立审批、应用、revision 及审计链。 |
| MCP | `mcp.ts`、`request-body.ts`；`src/app/api/mcp/amazon/route.ts`；`src/app/api/operations/amazon-mcp/route.ts`；`amazon-mcp-panel.tsx` | 独立个人凭证，随机 256 位秘密，SHA-256 哈希存储，一次展示。创建/禁用/撤销/轮换/过期/最后使用；旧凭证不自动获得任何 MCP 权限。每次调用并在返回前重查 ERP 授权与凭证交集。 |
| 历史归属与审计 | `lineage-audit.ts`、`scripts/audit-amazon-lineage.ts`、`read-audit.ts`、`scripts/ops-cli.ts` | 提供可重复只读报告；不猜 SKU/ASIN 归属、不回填。MCP 成功/拒绝/认证及协议方法、凭证操作、OAuth、授权变更、改名及主要 ERP 数据入口均写 AuditLog。CLI 业务 SQL 保持只读事务，输出前单独追加读取审计。 |
| 验证 | `tests/integration/amazon-mcp.integration.ts`、`amazon-multistore-security.integration.ts`；`scripts/test-amazon-sync-integration.mjs`；`tests/browser/amazon-multistore.spec.ts` 与现有同步中心测试 | 实际服务、Route、SQL、队列、文件存储路径；只有 Amazon HTTP 使用模拟响应。 |

## 权限链路

ERP 普通成员：有效组织成员 + 有效工作区 + 当前模块操作权限 + 用户或当前角色的有效 Seller / Marketplace / 操作授权。`marketplaceIds=[]` 沿用历史 ERP 的“该 Seller 已绑定站点”语义，不能凭不存在的站点读取数据。旧用户授权保留原 ERP 操作兼容性，但 `mcpEnabled=false`。

ERP owner/database_admin 保留组织内管理能力；主要 HTTP 数据读取审计包含角色与管理员标记，店铺管理读取另有审计。管理员也不能跨组织、工作区关系、成功发布及数据行归属约束。MCP 完全不使用管理员的隐式全店铺能力。

MCP：Bearer → 哈希查凭证（ACTIVE、未过期）→ 确定固定 org/workspace/user → 当前成员、模块操作权限、用户/角色显式 `mcpEnabled` 授权 → 与凭证 Seller/Marketplace 范围相交 → 已验证身份与同一授权的数据源 → SQL 查询 → 返回前重查 → 审计成功后返回。所有指定 Seller 逐一验证；不存在与无权限目标统一错误；组织/工作区/用户/实际 Seller ID 等非工具参数拒绝。没有凭证权限缓存，也不复用其他用户响应。

同步和 ERP 异步导出继续走已有审批与队列。MCP 仅开放只读工具，不开放同步、写入或发布工具。普通查看授权不会自动获得 export/sync/edit。角色与用户授权是允许项的并集，因此撤销用户项后如仍有角色项，ERP 权限仍有效；管理员应在管理页检查两类来源。

## API 与工具

- `POST /api/integrations/amazon/sp-api/oauth/start`：settings:edit + 组织管理员；选择官方区域，返回固定官方 Seller Central consent URL。
- `GET /api/integrations/amazon/sp-api/oauth/callback`：登录用户 + 单次 state。LWA code exchange 后使用 Sellers 参与站点和卖家范围 Listings 验证；固定回跳 `/operations?view=connections`。
- `GET/PATCH /api/operations/amazon-stores`：管理员店铺信息 / CAS 改名；`auditSellerId` 查询范围内名称及权限审计摘要。
- `GET/POST /api/operations/amazon-mcp`：自己的凭证元数据、可创建范围、工具目录 / 凭证生命周期。管理员指定他人时也不能超过该用户当前显式 MCP 授权。
- `POST /api/mcp/amazon`：无 cookie 回退的 stateless Streamable HTTP JSON-RPC；initialize/ping/tools/list/tools/call；GET 405。响应 no-store，body 流式上限 64 KB，拒绝异源 Origin。支持协议版本 2024-11-05、2025-03-26、2025-06-18；不声明持久会话或 SSE 推送能力。

| MCP Tool | 数据口径 / 上限 |
| --- | --- |
| amazon.stores.list / amazon.sync.status | 已验证授权范围内的数据源与同步状态；无数据源时不会伪造店铺数据 |
| amazon.inventory.list / amazon.catalog.list | 成功发布当前快照，50 行/页；page ≤ 10000 |
| amazon.inventory.summary | 仅授权已发布库存数量汇总 |
| amazon.sales.list | 最近成功的店铺逐日 Reports 快照；默认近 7 天，最长 90 天，50 行/页 |
| amazon.history.read | 指定已授权 source 的成功历史库存/刊登任务，50 行/页 |
| amazon.sales.export | 当前有效 export 权限，最长 90 天，最多 1000 行，单次返回 JSONL；超限要求缩小范围 |

所有工具明确标注快照/历史来源，包含必要 run ID、站点及采集/发布时间；不把同步数据称作 Amazon 实时数据。订单、利润、广告外部 API 尚未在当前 SP-API 执行器实现，因此没有添加会虚构这些数据的 MCP 工具。现有 PPC / Sellfox 独立来源未混入这些工具。

## 身份验证与历史边界

Amazon 的 marketplaceParticipations 不返回可信 Seller ID；不能将其当作 Seller 身份验证。这里使用 Amazon OAuth 返回的 `selling_partner_id`，并对该 Seller 执行官方 Listings 范围请求，要求合法结构；角色不足、拒绝或异常结构都失败关闭。这要求应用获得 Listings 所需角色。正式发布前仍须用目标 Amazon 应用及真实授权完成官方端到端验收。

ERP 昵称独立可编辑，不宣称是 Amazon 官方店名。手动凭证更新会清空身份验证标记；仅参与站点验证不能恢复该标记。收到授权拒绝的同步任务会按授权 revision CAS 标记 ERROR，避免旧任务覆盖新凭证状态。

旧授权存在同步历史而尚未验证身份时，OAuth 不会直接把旧历史认证为新身份。必须先审阅归属报告和原授权/run 证据。重复授权不覆盖其他 Seller / region 的凭证；站点授权收缩移除对应身份访问索引，业务快照与审计不删除。源绑定不允许同一 ERP Seller/站点跨数据域更换授权，也不允许同一授权站点映射多个 ERP Seller。

无来源、无 Seller 或 source/run/站点不匹配的行不进入普通已发布读取；MCP 还额外要求当前身份验证证据。历史手动绑定的 ERP 兼容读取与“已验证 Amazon 身份”不能混同：本地实施不等于已完成全库历史核查。发现冲突绑定或无法核查身份时，应暂停该范围的普通访问/同步并在批准后修复，不能通过开启 MCP 或按 SKU 推断来绕过。

只读报告命令（本次只对隔离夹具调用同一服务；未对现有环境执行脚本）：

```sh
npx tsx scripts/audit-amazon-lineage.ts --report-only --organization-id=<approved-org> --workspace-id=<approved-workspace>
```

脚本不加载 `.env`，要求操作者在审批目标中显式提供 DATABASE_URL；只读、repeatable read、15 秒 SQL 超时。报告不含 payload、SKU、凭证或原始行 ID，只给计数、原因与稳定 referenceHash；最多 10000 行，截断或异常退出码 2。截断报告不是全库验收结果，需另行批准扩大/分批核查。没有自动业务数据迁移脚本：无法确认的真实数据不具备安全自动回填条件。Prisma 增量迁移由迁移历史保证按环境执行一次；归属报告可重复执行。

## 数据库迁移与回滚

新增 `20261105010000_amazon_multistore_mcp`，在此前同步中心、审批、销售及用户授权迁移之后应用。

- AmazonSpApiAuthorization 增加验证时间、证据类型、授权人；旧行为 MANUAL_UNVERIFIED。
- AmazonDataAccessGrant 增加站点、操作及 MCP 开关；旧项 MCP 默认关闭。
- 新增 AmazonRoleDataAccessGrant、AmazonMcpCredential、AmazonOAuthAttempt、AmazonSellerIdentity，保留组织/工作区复合 FK、凭证状态检查与身份唯一键。
- 没有 UPDATE 历史快照、没有 credential/grant/identity 自动回填，没有删除表/字段/真实数据。
- 新表部分关系由 SQL 约束维护；后续 Prisma 迁移必须审阅保留这些 FK，禁止直接 db push 到现有环境。

应用回滚：关闭新入口或回退到上一兼容应用；保留新增列、表、身份证据、哈希和审计，不做自动 DROP 或业务数据回滚。MCP 所需显式授权默认关闭，因此撤销/关闭新入口即可停止访问。已撤销凭证不恢复。正式发布严格沿仓库 CI artifact 流程，数据库仅在迁移人工审核和目标环境批准后向前执行；失败记录数据库未回滚。

OAuth 所需环境变量名：AMAZON_SP_API_APPLICATION_ID、AMAZON_SP_API_LWA_CLIENT_ID、AMAZON_SP_API_LWA_CLIENT_SECRET、AMAZON_SP_API_OAUTH_REDIRECT_URI，以及现有 AMAZON_SP_API_ENCRYPTION_KEY。回调 URI 必须是应用登记的固定 HTTPS callback（仅 loopback 可 HTTP）。本次没有写入任何真实环境变量或配置文件。

## 性能与 RLS

MCP 无权限缓存，每次调用初始与返回前均做索引范围读取，另外追加审计。来源上限 200，授权上限 200，分页及导出有界。并发撤权以返回前的最后一次授权检查为准，已经传输给客户端的数据无法撤回。

未改变现有 worker 并发、没有新增全量前端载入或 Redis 权限缓存。管理页限定 200 店铺/来源、2000 授权/成员。正式环境需检查新增权限 SQL 和 append-only 审计带来的 P95、日志容量与保留策略；本机夹具性能不能当作生产 SLA。

RLS 已评估为额外防线：当前 Prisma 连接池使用共享数据库身份，若直接打开策略但未实现事务级租户上下文、专用非 BYPASSRLS 应用角色和 worker/迁移边界，会引入错误拒绝或绕过。因此此次采用应用层强制范围、复合 FK、成功发布检查及真实 SQL 回归；未假称已经启用 RLS。引入 RLS 需独立方案、性能对比及目标环境批准。

## 上线前未完成项

1. 确认整个已有工作区的提交范围，GitHub 同步与 CI 完整测试、lint、生产构建及 artifact 检查。
2. 目标环境人工审阅增量迁移、备份/回滚路径，再明确批准；本次没有实际迁移或部署。
3. 在批准目标上运行历史归属报告，处理冲突/待核查项，完成可审阅的归属处置；不得直接认证旧数据。
4. 配置经审核的 Amazon 应用/回调，真实验证 Seller、参与站点、身份范围请求、重新授权及撤销；目前只有模拟 Amazon HTTP 的集成证据。
5. 正式入口采用 HTTPS，复核网关请求限制、凭证生命周期运维、审计存储与生产 P95。当前仓库 IP HTTP 临时入口不能直接当作正式 MCP 秘密传输方案。

结论：本地实现与隔离回归完成；尚不具备直接宣布生产验收通过的条件。

## 自动化验证证据

隔离 PostgreSQL/Redis 所有临时容器在各 runner 完成后自动删除；本次最终检查没有残留 `codex.task=amazon-sync-integration` 容器。没有使用真实账号登录做 E2E。核心测试、ESLint（显式排除既有 `.next-amazon-live/**` 生成目录）、TypeScript 构成此次共享逻辑的 check:fast 等价路线；未运行生产构建/完整 `npm run check`，留给确认合码范围后的 CI 发布闭环。Prisma validate/generate 使用不可连接的 localhost:1 fixture URL，不连接业务数据库。

| 验证 | 结果 |
| --- | --- |
| npm test | 715 / 715 |
| MCP / OAuth / 身份 / 审批真实 PostgreSQL | 25 / 25 |
| S0 Route / CLI / 补货 / 下载安全真实 PostgreSQL | 11 / 11 |
| 同步中心 PostgreSQL / BullMQ / Worker / Chromium | 16 / 16 |
| 销售 Reports 审批→队列→发布→API→导出下载 | 1 / 1 |
| 销售 SQL 与约束 | 4 / 4 |
| 隔离浏览器（同步中心、个人凭证、改名） | 19 / 19 |
| TypeScript / Prisma validate / Prisma generate | 通过 |
| ESLint | 0 error，5 项既有 warning；生成目录排除，不修改/删除该目录 |
| git diff --check | 通过 |

| 用户安全验收项 | 真实服务 / 数据库覆盖 |
| --- | --- |
| 1 A 只读 A；2 不读 B；3 Seller 参数篡改 | MCP 全部 8 工具逐一传 B / 不存在 Seller；Route / CLI 同 SKU 读取 |
| 4 Marketplace 篡改 | MCP 站点拒绝；补货 PATCH 站点拒绝；导出 source 站点权限撤销 |
| 5 其他 workspace | MCP 参数白名单拒绝；Route / CLI 工作区及下载隔离 |
| 6 同 SKU 不混合 | A=3、B=999 同 SKU 的实际库存/刊登 SQL |
| 7 汇总 | 仅 A 库存 3，B 的 999 不进入 aggregate |
| 8 导出 | MCP 真实 sales SQL JSONL；完整 Reports pipeline + 文件下载；权限收缩阻断旧范围 |
| 9 MCP 撤销 | 已取到 identity 后数据库置 REVOKED，工具再次查库拒绝 |
| 10 ERP 撤销 | 已认证 identity 后 revoke；另用真实 PostgreSQL 表锁让查询等待、期间撤权，最终不返回数据 |
| 11 异步重查 | 补货 worker publication 锁期间撤权；export 执行/下载边界重查；同步 worker live scope |
| 12 缓存 | A/B 独立凭证交替读取，stateless/no-store；UI 工作区切换清除密钥和旧响应 |
| 13 管理员跨组织 | 实际数据库 member/workspace 解析及店铺管理拒绝 |
| 14 历史未知归属 | source-less/null Seller 不进入普通 CLI / 已发布查询；MCP 无身份或非成功 head 不读；只读归属报告识别孤立行且不按 SKU 猜测 |
| 15 存在性泄漏 | 所有工具对 B 与不存在 Seller 使用同样权限错误；响应不含 B 的标识和行 |


## 续作复核

补齐管理 Route 认证前的 body 上限：MCP 凭证和店铺改名 16 KB、OAuth start 1 KB，流式累计 UTF-8 字节，先拒绝异源、非 JSON、非对象、无 Content-Length 超限请求，再调用会解析 request clone 的权限 helper。非法 JSON 为 400，超限 413，媒体类型错误 415，异源 403。9 项边界回归、真实 session 管理入口验证及全部 715 核心测试通过；25 项 MCP PostgreSQL 回归通过，变更文件 ESLint、TypeScript、diff check 通过。本次没有 UI/schema/worker 修改，沿用上一批 19 项浏览器和其他队列回归证据，不机械重跑。

已准备完整改动区清单和 GitHub 新分支/草稿 PR 方案，见 `amazon-multistore-github-sync-plan.md`。独立商品会议记录代码及其文档明确列入待确认范围；未提交、推送、开 PR、迁移或部署。

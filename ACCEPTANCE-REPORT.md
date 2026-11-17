# ERP 生产部署前代码验收报告

> 验收依据：`ERP_全系统功能需求总纲与落地实施计划`（V1.0）
> 验收时间：2026-11-18
> 验收原则：以当前代码为准、状态诚实、禁止假成功、不自动部署
> 代码基线：`main` @ `9301ed1`（已 push，远程 == 本地）

## 一、状态定义（按需求文档第 13 节）

| 状态 | 含义 | 是否计入完成 |
|---|---|---|
| DONE_REAL | 真实环境/真实数据端到端验证，有日志与回读证据 | 是 |
| DONE_LOCAL | 本地真实依赖验证通过，生产未验证 | 计入本地完成 |
| PARTIAL | 部分链路可用，仍有明确缺口 | 否 |
| WAITING_AUTH | 等待真实 API 授权/凭证 | 否 |
| WAITING_EXTERNAL | 等待第三方/服务器/业务条件 | 否 |
| TECH_DEBT | 已知实现与需求有差距，延后处理 | 否 |

---

## 二、P0 安全与数据边界（本地可核验，全部合规）

| 需求项 | 需求来源 | 代码位置 | 状态 | 证据 | 风险 |
|---|---|---|---|---|---|
| 赛池/Amazon 双池物理隔离 | §2.1/2.2/2.3 | `prisma/schema.prisma` | DONE_LOCAL | 赛狐 `Sellfox*`（含 `payload Json`）、Amazon `AmazonSyncRawPage.rawCiphertext`/`Amazon*Snapshot` 分属不同表，无混合事实表 | 低 |
| ProductRecord 主档不被外部覆盖 | §2.3/4.1 | `src/lib/products/product-record-repository.ts:85,130,149`、`amazon-field-policy.ts:5-10`、`amazon-sync/policy.ts:46` | DONE_LOCAL | `sellfox/`、`amazon-sync/` 均无 ProductRecord 写入；写入前 `stripAmazonProductObservations` 剥离观察字段；统一经 `saveProductRecord` | 无 |
| MCP 强制 Seller Account + Marketplace 边界 | §6.2 | `src/lib/mcp/mcp-scope.ts:9-20`、`mcp.ts:822-823`、`data-access.ts:32-35` | DONE_LOCAL | 每次调用必须显式单账号+站点；服务端校验用户→账号分配，未分配 403 fail-closed | 低 |
| MCP 只读 + 禁止任意 SQL + 双池隔离 | §6.2 | `src/lib/sellfox/mcp.ts:181-232,424-439`、`isolation.ts:41-72,137-150` | DONE_LOCAL | `BEGIN READ ONLY`+只读 DB 角色、工具白名单、参数化查询、凭证行强制注入组织/工作区边界、跨源标识拒绝 | 低 |
| AI 不擅自写 Amazon | §0.1-10/§6.4 | `src/lib/amazon-ads.ts:203-211`、`amazon-action-audit.ts:85,120-125`、`ads-client.ts:27-28`、`remote-action-executor.ts:41,104` | DONE_LOCAL | 默认 dry_run + Adjustment Draft；写 transport 恒抛 `NOT_IMPLEMENTED`（开关无法绕过）；FBA 远程写需显式门禁；人工审批后方可 CONFIRMED | 低 |
| SP-API 与 Ads API 授权独立 | §2.2/§6.2 | `schema.prisma:3144-3172`(SP-API)、`:1834-1872`(Ads)、`mcp.ts:80-101` | DONE_LOCAL | 两套独立授权模型与校验路径，Ads 读取要求独立 `AmazonAdsAuthorization`，不因 SP-API 授权而开放 | 低 |
| 登录限流 / CSRF / 安全头 / 健康探针 | §4.10/§10 | `src/lib/auth/login-rate-limit.ts`、`csrf.ts`、`next.config.ts`、`src/app/api/health/route.ts` | DONE_LOCAL | 8/账号·30/IP·15分钟；Cookie 跨站写 CSRF 拦截；HSTS 可选；免登录探针 | 低 |

**结论**：所有 P0 安全边界在本地代码层面成立，无越权/主档污染/AI 越写风险。这是明天部署最关键的部分，已闭环。

---

## 三、生产发布就绪度（本地可核验）

| 需求项 | 代码位置 | 状态 | 证据 |
|---|---|---|---|
| 生产构建 | `npm run build` | DONE_LOCAL | 构建成功，standalone 产物 + middleware 编译，全路由生成 |
| 部署门禁（代码/产物） | `check:production --gate code` | DONE_LOCAL | 通过 10 / 阻塞 0 |
| 部署门禁（清单/资产） | `check:deploy`（生产模板渲染后配置） | DONE_LOCAL | 通过 28 / 阻塞 0；systemd×6、Caddy、backup、CSRF、health、onboarding 全齐 |
| 备份与恢复 | `scripts/runtime/backup-postgres.mjs` | DONE_LOCAL | 真实 `pg_dump` + `pg_restore --list` 校验 + sha256 + 原子 rename + 仓库外目录 + `--apply` 批准 |
| 发布 runbook | `deploy/README.md` | DONE_LOCAL | 唯一发布入口、密钥生成、口令轮换预演、双管理员凭据接入、备份恢复回滚、上线清单、门禁命令齐全 |
| 唯一官方同步执行端 | `scripts/runtime/worker-manager.mjs`、`deploy/systemd/*` | PARTIAL | 代码有 advisory 单实例锁、systemd 5 worker 单元；**本地/云端双端切换属运维动作，须部署时人工停止本地 worker** |
| 全量门禁 + 真实端到端 | `check:production --gate full` | WAITING_EXTERNAL | 需生产 EnvironmentFile、真实 DB/Redis、真实 Amazon 授权 |

---

## 四、上线前置条件与限制（必须由操作员完成，不造假）

> 以下本地无真实凭据/环境，**无法闭环**，按文档要求如实列为上线限制，禁止用本地测试替代。

1. **真实 Amazon 授权**：SP-API OAuth 授权、`AmazonSellerIdentity` 有记录、`AmazonSpApiAuthorization` 为 `CONFIGURED` 且 `identityVerifiedAt` 非空；Ads API 独立授权。
2. **生产环境配置**：用 `prod:env:init` 生成 EnvironmentFile 并填完 REPLACE 项，`ERP_RUNTIME_MODE=production`、`NODE_ENV=production`、`AMAZON_API_EXECUTION_ROLE=cloud`、`STORAGE_DRIVER` 用持久卷或 s3/r2。
3. **生产全量门禁**：在目标机用真实 EnvironmentFile 跑 `--gate full`，确认 `ready=true` 且 db.connect/migrations/clean、授权、授予、身份、数据源、worker 心跳全 PASS。
4. **真实端到端**：手动触发小范围同步，核验落库数据与官方返回一致；Ads profile/reporting 真实账号验收；页面与 MCP 回读数量一致。
5. **唯一同步端**：云端成为唯一正式同步执行端后，停止本地官方同步 Worker，避免双端重复执行。
6. **备份恢复演练**：在生产环境实测备份与恢复，关闭 `config.storage` 的 WARN。
7. **发布后冒烟**：登录、CSRF、限流、HTTPS/HSTS、关键页面与 API。

---

## 五、技术债（部署后处理，本轮不改，遵守"部署前不破坏现有代码"）

| 项 | 位置 | 需求冲突 | 为何本轮不改 |
|---|---|---|---|
| 赛狐域及 `ProductRecord.purchasePrice` 金额使用 `Float`（schema 共 140 个 Float 字段，多为金额/费用） | `prisma/schema.prisma:579,1327-1462,2887-3132` 等 | §3.2 要求"金额用原币+USD，Decimal/字符串，不用 float" | 改 Decimal 需 schema 迁移 + 20+ 读写文件类型契约变更（`number` → `Decimal`），影响查询/排序/导出/DTO，明天部署窗口改动风险 > 收益；按文档 §0.2"发现冲突先报告，不自行扩大范围"列为技术债 |

---

## 六、本轮结论

- **本地可核验部分已闭环**：P0 安全边界全部合规，生产发布资产完整，构建/测试/门禁全绿。
- **未闭环部分均为外部环境依赖**：真实授权、生产 DB/Redis、域名证书、唯一同步端切换、真实端到端——必须由操作员在目标机完成，本报告不假称完成。
- **本轮无代码改动**：审计未发现"可安全本地闭环且不破坏现有代码"的 P0/P1 缺口；不为优化而制造改动。
- 当前已 push 代码健康：2332 测试 / 0 失败、lint 0 error、code gate 全绿、生产模板 deploy gate 全绿、standalone 服务 health 200。

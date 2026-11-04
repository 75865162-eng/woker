# Amazon 多店铺 S0 安全修补交付

日期：2026-11-05（Asia/Shanghai）。基于 `amazon-multistore-security-audit-2026-11-05.md` 的 S0 方案；用户在审阅方案后指示“开始按要求做”。本批范围为本地应用修补和一次性隔离验证，不代表真实数据操作、配置启用或生产发布授权。

## 完成行为与权限链

- 补货 GET：session 用户/组织 → 当前 active 成员及 Seller grant → 有效店铺/站点 source 集合 → SQL 限定 policy、SellerAccount 和 plan。无 grant 返回 403，归属不明 policy 不返回。保留现有 Sellfox 模块查看限制。
- 补货 PATCH：模块 edit → 写事务内重新读取当前 edit 权限、Seller grant、活跃 SellerAccount 与精确 Marketplace 数据源关系 → 历史源需当前 sellfox:view 和同组织/工作区报表店铺 → upsert 与审计在同一事务提交。未授权 Seller、未知 Seller 和错误 Marketplace 均返回同一 403 文案。
- 后台补货：以 policy.updatedByUserId 在读取前和发布事务内复核上述权限。撤权后不再发布成功结果，也不写入带旧输入的失败快照；授权变化不触碰已有业务数据。Amazon 投影在数据库源查询阶段限定单个目标店铺/站点，避免管理员读全店后再筛选。
- CLI：runOpsCommand 自身调用身份/模块检查；Amazon 读取再解析当前 grant、active Seller 和已成功发布的 v2 source head。库存/目录查询携带 run+Seller+Marketplace，聚合相同；旧 source-less、null-Seller 快照不回退读取。任务列表只返回白名单摘要，不输出 checkpoint 或 frozenScope。PPC 库存新鲜度同样限授权范围。保持 PostgreSQL READ ONLY，不调用 Amazon。
- 多店查询只合并明确授权的已发布快照，各行保留店铺归属。多 head 的 runId 为 null，避免把聚合误标为单个批次；状态采用授权 head 中较旧完成时间作保守判断。
- ImportJob 结果下载：job 和 file 同时匹配 organization/workspace/user；跨用户、跨工作区和未知 ID 使用相同 404。成功下载记录 audit，不把底层错误回显，响应 no-store。

注意：本批 Marketplace 校验使用现有精确 AmazonSyncDataSource，不把 SellerAccount.marketplaceId 的本地 FK 或 SKU 当作官方站点证明。缺少该关系的旧补货策略保留原数据，但不能继续编辑、浏览或计算；不能为兼容而自动补绑定。Seller/凭证身份真实性仍属于 Phase 1/2 的未完成项。

## 本批文件清单

既有文件的本批修改（部分文件另有之前已存在的改动，不等于本批拥有整个 diff）：

- `src/lib/amazon-sync/data-access.ts`：新增后台可用的当前 action 和 Seller/Marketplace 校验。
- `src/lib/amazon-sync/read.ts`：已发布快照源可按目标店铺/站点进一步收窄，使用 AND 保留原 grant 条件。
- `src/lib/operations/amazon-products.ts`：目标范围传至源和任务 SQL 查询。
- `src/lib/operations/replenishment-service.ts`：读前、成功/失败发布前校验。
- `src/app/api/operations/replenishment/route.ts`：查询范围、写权限、事务审计和脱敏拒绝。
- `src/lib/operations/cli.ts`、`ppc-read.ts`、`scripts/ops-cli.ts`：CLI 调用入口和数据范围收口。
- `src/app/api/files/[id]/download/route.ts`：job/file 所有权、工作区和下载审计。
- `tests/ops-cli.test.ts`、`tests/operations-replenishment-service.test.ts`：扩充 fake fixture 以适配新校验；撤权后不发布的行为断言。
- `scripts/test-amazon-sync-integration.mjs`：新增 `--security` 模式，复用已有隔离迁移、存储和清理边界。
- `AGENTS.md`：补充隔离验证命令及适用边界。

新增文件：

- `src/lib/operations/amazon-read-scope.ts`：在调用方事务内解析 CLI 的实时授权和 published heads。
- `src/lib/operations/replenishment-access.ts`：供 Route 和后台复用的实时校验。
- `tests/integration/amazon-multistore-security.integration.ts`：真实 Prisma/PostgreSQL/Route/storage 安全回归。
- 本交付文档。前序审计报告为原方案，原报告“仅静态审计”的运行记录不应替换为本批执行记录。

## 数据库、API 和回滚

本批不新增 schema 或迁移，不回填历史数据，不创建真实权限。隔离 runner 使用预装 postgres:16-alpine 和 redis:7，在随机 localhost 端口的一次性空库中应用现有五项 Amazon 迁移；只写合成 fixture，外部 HTTP 全部禁止。未访问现有开发/联调/生产数据库、私有凭证和真实存储。

既有补货 API 和下载 URL 保留；新增拒绝场景如上。CLI 任务输出收窄为摘要，库存/目录改读授权 published heads。未增加入站 MCP endpoint 或签发 MCP 凭证。

回滚只撤回本批代码，无数据库逆迁移。恢复旧权限逻辑会重新暴露漏洞，出现兼容问题应先关闭相关入口，不应以绕过 grant 或读取归属不明数据降级。任何生产配置变更或部署需独立审阅和授权。

## 验证结果

1. `node scripts/test-amazon-sync-integration.mjs --security`：11/11 通过。覆盖真实补货读/写、同 SKU 双店和聚合、未知/越权响应等价、历史归属缺失、CLI 白名单、数据库投影范围交集、工作区/组织边界、下载所有权、授权撤销、发布前撤销与 Sellfox 模块撤权。
2. 并发测试：在独立 PostgreSQL 事务持有 policy 发布 advisory lock；真实 worker 计算完成等待该锁，另一事务撤销 grant，再释放锁。断言没有 plan 或失败输入快照落库。
3. `npm run test`：706/706 核心测试通过。
4. `npm run typecheck`：通过。
5. `npm run check:fast`：核心测试通过，但默认 lint 扫描既有未跟踪 `.next-amazon-live/` 构建产物，产生 2108 个错误并提前结束，不能标为整体通过。使用 `node node_modules/eslint/bin/eslint.js --ignore-pattern '.next-amazon-live/**'` 对源码全量等价复核：0 错误、5 条既有警告；单独 typecheck 已通过。未修改 lint 配置或清理该目录。
6. 隔离资源：runner finally 清理一次性容器/临时目录；测试后查询 `codex.task=amazon-sync-integration` 标签容器为零。

采用 API/共享逻辑级验证。未运行完整生产 build、浏览器 E2E 或真实 Amazon 联调：本批无 UI/构建链变更，真实服务层和 SQL 覆盖关键拒绝路径；完整 check/CI 构建留待合码准入，真实联调需单独批准。本批结果不是生产 P95、全功能 MCP 或官方 OAuth 的验收。

## 性能与剩余工作

权限不跨请求缓存，每个读写/计算阶段新增成员、角色、grant 和精确 source 查询；一次操作内 published source 上限 200，CLI 页大小 50、补货候选 50，未引入全量商品加载或后台外部采集。额外数据库往返会增加延迟，未建立生产 P50/P95/P99；不得据隔离测试耗时承诺生产 SLA。后台因拒权而跳过的策略仍可能在后续 tick 被重新检查，候选公平性和告警/审计归入后续调度收口，需在规模上线前验证。

S0 只修复本报告列明的现有权限入口。仍未完成：OAuth 真实 Seller 身份闭环、跨域 Seller 映射一致性、Marketplace/action/role grant 扩展、完整查询/拒绝/管理员审计、独立 MCP token 生命周期和 ERP∩token 范围、全历史实际归属盘点、15 项完整 MCP 安全矩阵及生产验收。Sellfox 模块权限不能代替将来需要的报表店铺授权映射；未将历史第三方来源宣称为 Amazon 官方实时数据。

本地修补和验证完成；未提交/推送/部署，当前全部改动区尚需独立盘点与审阅。整个多店铺/MCP 项目不具备生产上线条件。

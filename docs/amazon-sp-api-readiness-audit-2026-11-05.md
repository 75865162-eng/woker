# SP-API 填写凭证前代码完整性检查

日期：2026-11-05。基线：当前本地工作区，包含原有未提交和未跟踪改动。不代表 GitHub、运行中的本地实例或服务器版本。

## 结论

已存在凭证加密、审批、LWA token 刷新、授权验证、数据源绑定、持久化任务、Redis/BullMQ 分发、分页/报告处理、快照发布及页面查询链路。不能据此确认“填完凭证一定能同步”：本轮集成验证有两项未通过，实际运行环境和真实 Amazon 授权尚未验收。

已接入 catalog、inventory、sales_traffic；订单、财务、退货、赔偿、库龄、价格、品牌分析等在 policy.ts 中明确未实现。销售流量是报告日期汇总，不是订单明细。保存计划不会自动获得后续执行授权，scheduler 只分发已审批的执行意图。

## 本轮发现

1. 商品集成测试的响应路由遮蔽测试输入。`tests/integration/amazon-sync-center.integration.ts:52` 对所有 Listings 请求固定返回空 items，后面的可变 transport 无法收到商品同步请求。第 150 行期望畸形分页失败，实际得到空快照成功。这是测试夹具问题，不能据此判定真实执行器接受了畸形响应，也不能宣称商品端到端测试通过。
2. 销售流水线测试没有模拟新增身份探测。`tests/integration/amazon-sales-pipeline.integration.ts:91` 的官方端点分支缺少 Listings 请求处理；配置验证调用 `service.ts:77` 后被测试禁止未模拟 HTTP 的守卫拒绝。失败发生在报告创建前，不能认定日报采集链路已验收。
3. 运行前权限条件比三项 LWA 凭证更严格。`service.ts:76` 对所有返回的参与站点执行 seller-scoped Listings 探测；任一失败都会阻止 CONFIGURED。应用必须具备对应商品读取权限；仅库存权限或只能访问部分参与站点的凭证可能无法通过当前验证。不能通过删除身份校验规避此约束。
4. 客户端未显式设置可识别应用的 User-Agent（`sp-api-client.ts:123`）。用户提供的指南要求该请求头；底层 fetch 可能提供通用默认值，本轮未抓取真实请求，不能声称该差异必然导致 Amazon 拒绝。建议补充明确应用 User-Agent 及 mock 断言。
5. 指南是通用教程，附录 `SP_API_*` 不是本项目配置名称。当前页面入口为 `/operations?view=connections`；Settings 只是跳转入口，旧 credentials/bindings 写入口已退役，不应按旧文档恢复。

## 验证结果

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| `tsx --test tests/amazon-*.test.ts tests/amazon-sync-preflight.test.mjs` | 93/93 通过 | mock / 纯函数，不证明真实凭证有效 |
| `npm run typecheck` | 通过 | 当前工作区类型检查 |
| Amazon client/sync、相关 routes/UI、worker 定向 ESLint | 通过 | 未跑全仓 lint |
| `npm run test:amazon-sync:integration` | 15/16 通过 | 一次性 PostgreSQL 16、Redis 7；Amazon HTTP 全模拟 |
| `node scripts/test-amazon-sync-integration.mjs --sales-pipeline` | 0/1，通过前置授权时失败 | 同上；原因见发现 2 |
| `npm run test:amazon-sync:browser` | 29/29 通过 | 隔离模拟接口与真实样式，无真实凭证 |

库存验证包含真实 BullMQ 消费、带登录态 Route→审批→任务→worker→店铺快照、凭证轮换、分页故障保留旧 head、租约/撤权/版本变化阻止发布。商品及销售报告不因这些通过项而获得端到端验收结论。

集成 runner 使用预装镜像、新建随机命名一次性容器与临时文件目录，测试结束清理自身资源；没有执行真实业务库迁移、连接现有 Redis、调用真实 Amazon 或启动真实业务任务。没有运行完整生产构建、部署检查或真实性能测试，因为本次为限定范围代码审阅。

## 待核实的运行条件

- PostgreSQL 中已有当前代码需要的表/字段及迁移；本轮只在一次性空库使用既有 runner 测试部分迁移，没有核对真实库迁移状态或全部迁移历史。
- 有效 `AMAZON_SP_API_ENCRYPTION_KEY`；当前组织/工作区位于 `AMAZON_SYNC_CENTER_SCOPES`。
- `QUEUE_DRIVER=redis`、可用 `REDIS_URL`，与 web 使用相同数据库/范围/密钥的 Amazon sync worker 在线。
- 当前组织有效管理员具备 settings:edit、operations:approve 以及实际操作所需业务权限。
- 同一应用的 Client ID/Secret/Refresh Token，真实 Seller ID、正确区域和官方 Marketplace ID。
- 保存授权申请→批准→应用；验证授权申请→批准→应用成功；绑定 ERP 店铺/站点/数据域并批准应用；单独申请同步执行并批准应用。

本轮没有读取私有环境文件或真实凭证，没有查真实数据库，因此上述是验收条件，不能标记已满足。

## 修正进展（2026-11-05）

按以上最小方案已完成隔离修正：SP-API client 为请求加入固定应用标识和 TypeScript 版本的 `User-Agent`，客户端测试验证 LWA-only 和兼容配置都发送该头；商品集成测试把 Listings mock 与通用/inventory transport 分开；销售日报 fixture 增加 Seller-scoped Listings 身份探测响应。未调整真实配置、数据库 schema 或授权策略。

重跑结果：Amazon sync disposable integration 16/16 通过（包含商品快照分页与完整性校验、库存 browser 到 worker、数据库/Redis fixture）；sales pipeline disposable integration 1/1 通过；Amazon 相关单元测试 93/93、SP-API client 8/8 通过；typecheck、上述相关文件 ESLint、`git diff --check` 通过。测试外部传输仍全部由 mock 拦截；运行环境仍为随机 disposable PostgreSQL/Redis 和临时文件目录，不代表真实凭证、Marketplace 角色、线上 schema 或 Amazon 请求已经验收。

隔离测试和请求头缺口已修复。是否能连接及同步，仍需在目标配置环境完成实际授权验证和受控单店同步；用户指南的通用环境变量名仍不能用于本项目直接配置。没有运行 full build、真实 Amazon 联调、生产库迁移或部署。

## 最小后续方案

先修复两个隔离测试夹具：将身份验证与商品采集的 mock 路由明确分开，保留未模拟请求拒绝守卫；日报夹具补齐 seller-scoped Listings 校验。复跑两条失败链路，确认是否还有业务代码缺陷。若修改共享 Amazon transport 的 User-Agent，仅改请求头并补定向测试；回滚为撤销该头和对应测试，无数据迁移。站点选择/权限校验行为若需调整，须单独评审身份边界，不能静默跳过失败站点。

真实验收另行限定环境、组织/工作区、Seller、Marketplace、数据域及任务：先验证授权，再以一个店铺/站点的 FBA 库存任务核对成功状态、记录数和页面数据。外部验证会访问 Amazon 并更新授权状态/审计，真实同步会写快照和任务记录；应在该具体方案获准后执行。此次检查没有授予这些操作执行批准。

本轮仅新增此检查报告，未修改应用、测试、配置、迁移或已有工作区改动；未提交、推送或部署。

## 后续 403 排查提示修正

用户报告 `403 Access to requested resource is denied`。旧即时错误没有接口名称，历史 AUTH_REJECTED 也不能还原失败接口；未读取真实凭证或重试 Amazon，无法判定当次是 Sellers 还是 Listings 拒绝。

`performAuthorizationValidation` 现在通过 client 的 onResponse 记录本次内存中的接口名称，在即时 HTTP 失败提示后增加 LWA、Sellers.getMarketplaceParticipations 或 Listings.searchListingsItems 失败步骤。不保存请求体、URL、凭证或新的数据库字段，不改变身份验证/审批/同步策略，不将网络错误伪称为 Amazon 响应。只有未来的新验证使用该版本代码时才会产生步骤提示，历史记录不补造诊断。

验证：相关授权与客户端模拟测试 12/12 通过；TypeScript、两处修改文件 ESLint、定向 diff whitespace 检查通过。没有修改真实配置、访问业务数据库、执行真实请求、重启服务、提交或部署。完整构建与真实联调未运行。回滚仅撤销本次提示及对应测试，不改变凭证或授权状态。

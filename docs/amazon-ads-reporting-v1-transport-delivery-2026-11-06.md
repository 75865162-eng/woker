# Amazon Ads Reporting v1 transport delivery

Date: 2026-11-06

## Scope and evidence

The Amazon Ads Reports OpenAPI contract was read from the official specification:

- https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/AmazonAdsAPIALLReportsContract_prod_3p.json

The contract confirms the NA/EU/FE regional hosts, `POST /adsApi/v1/create/reports`, `POST /adsApi/v1/retrieve/reports`, the `Amazon-Ads-ClientId` header, OAuth `advertising::campaign_management`, HTTP 207 multi-status responses, one report and one period per create request, required query fields, and up to 100 completed report parts. Create identity is an explicit `advertiserAccountId` or `managerAccountId`; an Amazon Ads Profile ID is not substituted.

This generic OpenAPI contract does not establish the Sponsored Products Campaign field combination, field compatibility, report date semantics, target-account permission, or download hostname allowlist. No such details are inferred here.

## Implemented locally

- `src/lib/amazon-ads/reporting-v1-transport.ts` provides an injected-fetch protocol transport for create, retrieve, and bounded part downloads. It uses only the V1 client header, bounds request/response time, refuses redirects, treats an uncertain create result as non-retryable, and returns retry metadata only for read operations. Download host allowlists are fixed when the transport is constructed and default to empty. Signed URLs remain in the internal result only and must not be logged or returned to clients.
- `AmazonAdsProfile.advertiserAccountId` and `advertiserAccountRevision` persist a separately entered V1 identity. `authorization.ts` requires settings-manager permission, the exact internal Profile record ID, revision-based compare-and-set, and an audit digest. The value is marked `ADMIN_ENTERED_UNVERIFIED`; saving it does not create or resume a sync plan.
- `scripts/amazon-sync-worker.ts` explicitly rejects `process-amazon-ads-report-task` before any processor fallback. `report-dispatch.ts` keeps live readiness hard-disabled; runtime environment flags and manually entered account IDs cannot enable it.
- Migration file: `prisma/migrations/20261106040000_amazon_ads_advertiser_account_id/migration.sql`. It was not executed.

## Not production-ready

The V1 Campaign report contract, field allowlist, report fact parser, download host evidence, durable V1 report state machine, regular scheduler dispatch, target-account permission, and real-account acceptance remain incomplete. The existing V3 report acquisition and report worker remain isolated-fixture-only. No Amazon API request or production sync was made. Do not enable the Worker route until these blockers have evidence and a separately reviewed implementation.

## Offline verification

- `tests/amazon-ads-reporting-v1-transport.test.ts`: transport contract and failure behavior, fixture-only.
- `tests/integration/amazon-ads.integration.ts`: profile binding CAS, scope, audit redaction, and no plan/task side effects, using disposable PostgreSQL/Redis.
- `tests/browser/amazon-ads.spec.ts`: administrator account-binding interaction, mocked browser API.

## 本批交付与边界（中文）

本批完成的是 V1 HTTP 协议底座与独立身份录入，不是完整生产报表同步。`createReportingV1Transport` 必须显式注入 fetch，没有默认网络工厂；没有生产调用方。字段只按通用 OAS 校验字符串数组，不声明任何 Campaign 字段兼容性；filter 已在下述后续批次补齐；currencyOfView 等仍未实现。下载按构造时精确主机白名单、HTTPS、拒绝重定向、总截止、字节数与本地 8 MiB 上限检查；8 MiB 为本地安全上限，不是 Amazon 官方文件限制。暂不支持超过该大小文件、持久化多分片恢复、解压或事实发布。DNS/实际下载主机可信性、分片完整性与总文件预算仍需正式运行层实现，禁止直接接入生产。

页面：广告账户与授权，复用 `src/components/amazon-ads/ads-accounts.tsx`。通过既有 `GET/POST /api/integrations/amazon/ads/profiles` 查询/保存。页面入口沿既有设置页；API 要求 settings view/edit，保存服务再次实时校验组织成员、用户状态、工作区和 settings edit 权限。此处不新增业务角色。advertiser account 保存采用内部 Profile ID、当前值和 `advertiserAccountRevision` CAS；跨工作区、非管理员和旧版本写入被拒绝。审计保存 ID 摘要及未验证标记，不保存原始 ID。旧式外部 Profile ID 店铺绑定仍兼容，但出现歧义时拒绝随机选择记录。

管理员录入的 ID 不是 Amazon 验证结果；`accountInfo.id`、内部 Profile ID 和 Amazon Profile ID 均不会自动填充该字段。没有调用账号发现或连接测试。普通 ERP/MCP 查询及现有 fixture 报告执行器不消费此身份字段；未来运行 manifest 必须冻结该值、revision、授权身份/版本及区域，并在调用与提交前复查，不能只检查当前账号字符串。

### 执行结果

| 检查 | 结果 | 实际边界 |
| --- | --- | --- |
| transport 专项：`node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-reporting-v1-transport.test.ts` | 11/11 通过 | 注入 Response/stream，无外部 HTTP |
| `node scripts/test-amazon-ads-offline.mjs` | 结构/绑定 20/20，MCP 13/13 通过 | 一次性 PostgreSQL/Redis、临时 storage、网络 guard；不是 Amazon 账号验证 |
| 账号页：`node node_modules/@playwright/test/cli.js test --config tests/browser/amazon-ads.config.ts --grep 'accounts page displays'` | 1/1 通过 | 浏览器请求全模拟，含店铺绑定及 V1 ID 保存 |
| `npm run check:fast` | 单元测试 920/920；lint 阶段失败，未继续类型检查 | 预存未跟踪 `.next-amazon-live` 被 lint 扫入；没有删改该产物 |
| `node node_modules/eslint/bin/eslint.js --ignore-pattern '.next-amazon-live/**'` | 0 errors，5 个既有 warnings | 仅命令行临时忽略，不改 ESLint 配置 |
| 本批文件定向 ESLint | 通过 | 不自动修复、不格式化其他文件 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过 | 全库类型检查，后续局部改动后复验 |
| Prisma validate/generate | 通过 | 临时 config 使用无服务的 fixture URL，不载入 dotenv、不连接真实 DB |
| migration SQL | 未执行、未验证真实迁移 | 仅编写 additive SQL；fixture runner 使用 db push，不是 migrate deploy 证据 |
| 浏览器首次错误 runner | 失败 | `node_modules/playwright/cli.js` 与 @playwright/test 版本不同；用同源 @playwright/test CLI 重跑后通过，未更改依赖 |

### 发布与回滚

- 本批没有 commit、push、配置写入、真实 API 请求、真实任务、部署或真实数据库迁移。共享工作树原有改动保留。
- 新代码会读取新增列，因此未来发布必须先审阅并应用配套迁移、generate，再更新 web；不能把未迁移数据库上的页面正常运行列为已验证。
- SQL 仅增加 nullable account ID 和 default 0 revision，不补历史数据、不重建业务事实。表 DDL 锁和目标数据库版本/容量仍需发布前评审；没有线上耗时 benchmark。
- 回退应用到旧代码，新增列保留；不自动 drop 列、不执行 down migration。旧代码不消费这些新增字段，报告 live gate 保持关闭。
- 下一步依次核实 V1 Campaign 字段/日期/归因合同、账号权威映射和下载来源；再实现冻结 manifest、持久状态机、多分片有界采集、常规 scheduler 与共享 Client ID 配额，最后申请精确账号/日期/预算范围的真实验收。当前 T02、T07–T11 不因本批协议底座而标记全部完成。

## 后续批次：filter 与创建回执一致性（2026-11-06）

本批继续处于已批准的本地代码/离线验证范围；不启动真实请求、任务或迁移。仅更新 transport、专项测试和本文档，保留其他工作树改动。

### 官方合同证据

本批重新读取上述 Amazon 官方公共 OpenAPI，原始文件 SHA256 为 `e31ce6d53697bf20497e9a1068c8fa7594a9384957971d8ff0ab53c894ec918f`。公共文档下载不含账号凭证，不是 Ads 账号 API 验证。可复查的 schema：`CreateReportingQuery` / `ReportingQuery`、`CreateFilter` / `Filter`、`CreateCompositePredicate` / `CompositePredicate`、`CreateComparisonPredicate` / `ComparisonPredicate`、`ComparisonOperator`。

- `filter` 为可选；每个节点 oneOf `and` 或 `on`。
- `and.filters` 为 1–10 个递归节点；`on` 必需 `comparisonOperator`、`field`、`not`、`values`。
- `field` 格式 `^[a-zA-Z0-9]+\.[a-zA-Z0-9]+$`；比较符仅 `EQUALS` / `IN`。OAS 描述要求 `EQUALS` 恰好一个值，`IN` 至少一个；values 上限 2,000。
- 这些通用语法不证明 `campaign.id`、`campaign.state` 等实际业务字段支持情况。测试中的字段和值都是人工 fixture，不作为可运行 Campaign 查询模板。

### 代码边界

`src/lib/amazon-ads/reporting-v1-transport.ts`：新增 `ReportingV1Filter` 与 `snapshotFilter`，拒绝未知属性、非法比较符、空/稀疏数组及循环/过深结构。同步复制 fields、日期与所有 filter 节点后才发起异步 HTTP，调用方后续修改不影响发送内容或回执校验。

本地保护限制（不是 Amazon 官方额度）：根 depth=0、最大 depth=8、总节点 100、全树 values 总计 2,000、单值和 filter field 最多 512 个 UTF-16 code units、值累计 256 Ki code units、查询字段累计 64 Ki code units、序列化 report 最大 512 KiB。仍保留原有 64 KiB 回执上限和 8 MiB 下载上限；较大的合法 Amazon 结果会被本地拒绝，不能声称支持任意官方报告规模。

成功 create 回执必须匹配 format、起止日期、有序 fields 和 canonical filter（忽略 JSON 对象属性顺序，保留数组顺序）；否则报 `ADS_REPORT_V1_RECEIPT_MISMATCH`，不内部重发。回执 filter 非法同样拒绝。此类拒绝发生在远端可能已创建报告之后，未来持久执行器必须阻断并人工/受控恢复，不能将其解释为“远端未创建”。retrieve 目前只校验 reportId，未来运行层仍须将返回的 periods/query/format 与冻结 manifest 比对。

`ReportingV1Result` 成功分支附带内部 periods/query 供一致性校验；含过滤值与签名 URL 的内部结果不得直接传给 UI/MCP 或日志。没有修改通用安全 envelope parser 的公开返回合同。

### 本批实际验证

- `node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-reporting-v1-transport.test.ts`：15/15 通过。覆盖嵌套 filter、未知属性、非法比较符、EQUALS 多值、稀疏/循环结构、超长值、调用后变更、日期/字段/格式/filter 分别错配以及既有下载/超时/live gate 回归。
- `node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-sync.test.ts`：16/16 通过，包含通用 Reporting v1 envelope 安全解析；全部为注入 fixture，无外部 HTTP。
- 定向 ESLint 与 `tsc --noEmit`：通过；最后局部防护调整后再次复验，结果以本批末尾记录为准。
- 首次新测试因括号缺失不能解析，修复后以上专项通过；未把失败执行计为通过。
- 未重复数据库/浏览器集成、Prisma 检查、完整 check/build：本批没有更改 DB、UI、授权、依赖或构建链；准备合码/上线时须做完整检查。前批结果保留为历史证据，不算本轮重跑。

### 下一阶段与回滚

当前 StorageDriver 只有 Buffer/文件式写入，无 stream 写入，见 `src/lib/storage/types.ts`。因此本批没有扩大下载内存上限或改共享 StorageDriver。持久 V1 执行器仍需冻结身份/revision/授权/区域/字段/日期、共享限流预算、未知 create 结果处置、租约/fence、多分片预算和发布一致性；具体 Campaign 合同、账号权限与下载来源证据先完成，live gate 继续固定关闭。

回滚本批 transport/filter 与测试局部改动即可；没有新增迁移、配置、调度入口或运行态数据，无需数据库回滚。未执行 commit/push；不代表 GitHub 或服务器已同步。

最终复验：transport + Ads sync 合并执行 31/31 通过；定向 ESLint 通过；全库 `tsc --noEmit` 通过。未运行数据库迁移、浏览器、完整构建或真实 Ads API 验收。

后续：已新增仅离线的持久 V1 create/poll 核心，见 `docs/amazon-ads-reporting-v1-acquisition-delivery-2026-11-06.md`。旧文中“持久 V1 未实现”指完整生产运行层，仍未完成；当前新增核心不启用 live。

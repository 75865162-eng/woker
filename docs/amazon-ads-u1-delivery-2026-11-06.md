# U1 第一批交付：Campaign 日报、版本发布与 Skill MCP 离线闭环

日期：2026-11-06。**完成的是隔离环境纵向切片；U1 的正式 worker 接线、真实账号合同验收及线上采集尚未完成。**

## 已完成的行为

- 新增 `src/lib/amazon-ads/campaign-report-contract.ts`：固定 SP Campaign / DAILY / `spCampaigns` / `GZIP_JSON` 子集，显式选择 1/7/14/30 天归因，金额和计数输出字符串，保留零与 null。拒绝重复日/Campaign 粒度、越界日期、币种不符、未知列、不安全数字、损坏 gzip 与超限内容。
- 新增 `src/lib/amazon-ads/report-acquisition.ts`：注入模拟 transport，每次调用处理 CREATE → POLL → DOWNLOAD → STAGE → PUBLISH 中的一步。Request JSON 持久化阶段、截止时间、预算、在途 reservation；先扣预算再调用 transport。未知 create 结果保留阻断记录，不重复创建；替换 fence 可重试只读操作。
- 经过校验的请求/响应 JSON 使用现有 Ads AES-GCM 与组织/工作区/授权/任务 AAD 加密；完整 gzip 经 storage adapter 保存，通过 FileObject、ReportDocument 关联请求、Profile、哈希和字节数。下载 URL 加密保存且不作为对象路径。
- 后续 U1-A 收口在既有 `ReportRequest.requestOptions` 内保存 scope digest，绑定任务/计划 revision、Profile、授权 ID/revision、Seller/站点、日期、币种、时区和合同；同 revision 换绑会在 transport 前及发布前阻断，不新增 schema/migration。
- 后续 U1-B 收口增加可选 `StorageDriver.getBoundedBuffer`；local 和 S3/R2 stream reader 有界读取，Ads 报告拒绝不支持有界读取的 driver。成功 create/poll 的 request/response body 原字节以 AES-GCM 加密证据保存；错误只记录脱敏错误码，不存失败正文。
- 发布复用现有 ReportVersion/Fact 与事务边界；校验文件元数据、行数、证据引用、合同、实时授权、计划 revision 和 lease/fence。任务成功与版本发布同事务提交。暂存不可见，修订版本替代当前结果且保留旧事实。
- `/amazon-ads/campaigns` 已同步数据的 SP Campaign 详情新增“查看 Campaign 已发布日报”，传内部 Profile ID、Campaign ID、报告类型与广告产品，清空 Ad Group/搜索条件，保留日期范围。继续使用现有服务端已发布事实查询及 `amazon.ads.reports.list`，展示来源任务、版本、零/null；不新增工具授权。
- 同步任务详情 API 返回任务、Attempt、报告请求/文档、发布版本和域 freshness；账户页支持详情入口及 Attempt 分页。
- Skill/ERP MCP 设置页支持调用记录的服务端分页、成功/拒绝筛选和工具筛选；记录只保留安全参数摘要、结果摘要和错误信息。

共享事实仍以服务端 PostgreSQL 为持久层；文件经 storage adapter 引用。未修改 Prisma schema、运行配置或正常结构同步路径。

## 官方文档核对及版本选择

本批只读核对公共文档，未登录 Amazon 或调用账号 API：

- [Campaign v3](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types/campaign)：`spCampaigns`，最大 31 天、历史 95 天，Campaign 粒度，日期/币种、cost、purchases/sales/unitsSoldClicks 归因列。
- [Reporting v3](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/get-started)：异步创建、状态轮询和单个 gzip 文件下载；不能按 V1 multipart 处理。
- [Reporting V1](https://advertising.amazon.com/API/docs/en-us/guides/reporting/ads-v1/quickstart)：`advertiserAccountId` 与 V1 query/retrieve 合同不同；不能用内部或 Amazon Profile ID 直接代替该账号身份。

V3 文档提示 2027-06-30 停用，因此本批只把核实的 V3 子集作为离线基线；`liveEnabled=false`。这不代表完成了账号、地区、请求头、完整覆盖、归因最终确定时间或 V1 迁移验收。初稿提出的“两分片”场景改为符合 V3 的单文件测试；没有制造 V1 多分片支持。

## 隔离闸门与资源策略

采集入口同时要求显式 offline fixture 标记、loopback `/amazon_sync_test` 数据库、local storage 的绝对临时目录、`ISOLATED_FIXTURE_ONLY` transport 和当前用户创建的 `isolated-report` 任务。没有默认 HTTP transport，未接入 scheduler 或正常 sync adapter。

当前策略上限为：31 天、压缩 1 MiB、解压 8 MiB、1000 行；创建 1 次、轮询 10 次、下载 3 次，轮询间隔 60 秒，总截止 15 分钟、单次网络操作 5 秒。这些是隔离测试策略，**不是 Amazon 配额或正式运行 SLA**。官方报告可能耗时更长，不能直接沿用到生产。

下载仅接受 HTTPS `*.invalid` fixture 地址，拒绝重定向、过期 URL、非 200、超限/截断内容。正常离线路径没有新增后台任务，因此不能据测试耗时宣称线上 P95 已验收。

## 验证结果与复现

| 验证 | 结果 |
| --- | --- |
| 清空继承环境并加载网络保护的 `tests/*.test.ts` | 867/867，通过；包含 Campaign parser 4 项 |
| `node scripts/test-amazon-ads-offline.mjs --reports` | 23/23，通过，含同 revision 授权换绑与超大对象拒绝 |
| `node scripts/test-amazon-ads-offline.mjs --mcp` | Ads MCP 10/10，通过 |
| `node scripts/test-amazon-ads-migrations.mjs` | 通过；一次性 PostgreSQL，未触碰持久数据库 |
| `npx playwright test --config tests/browser/amazon-ads.config.ts` | 21 项通过，1 项历史列表计数定位失败；修正定位后仅重跑该项，通过；未机械重复其他 21 项 |
| 定向能力、Campaign parser、scope digest 和 bounded buffer 单测 | 11/11，通过 |
| `npm run typecheck` / 全仓 `npx tsc --noEmit` | 最近一次新增 scope/storage/evidence 后需重跑；此前本地通过 |
| 相关源文件/测试定向 ESLint | 通过 |

集成运行器只创建并清理一次性 PG/Redis 和临时 uploads，使用预装镜像，不拉取镜像、不继承 dotenv/真实凭证；网络保护拒绝外部连接。测试覆盖未知创建结果、预算/截止、过期和非法下载、截断及存储损坏、替换 fence、处理中撤权、暂存后计划变更、版本修订、API/MCP 同源读取和精度。

独立迁移 runner `node scripts/test-amazon-ads-migrations.mjs` 通过：空库安装、旧行升级、nullable metrics、Profile/task 外键、事实幂等键，以及历史 Profile 错配阻断均在一次性 PostgreSQL 容器中验证；没有迁移持久数据库。

扩展回归中另修两处测试问题：任务详情 fixture 设置为已失败以免占用后续同步名额；浏览器任务列表计数排除详情表。未调整对应业务行为。当前工作区还有其他聊天的账户/同步详情/MCP 面板改动，未撤销、提交或推送这些内容。

本次采用相关隔离集成、浏览器、全量核心测试、TypeScript 和定向 lint 验证。未运行完整生产构建、全仓 lint、真实账号 E2E 或服务器检查；合码/上线时再执行完整检查。全仓 lint 还需先明确现有 `.next-amazon-live/` 生成目录处理范围，不在此清理。

## 剩余边界与下一步

1. 确认 V1/V3 账号身份映射和目标报告合同，决定正式适配版本；真实 Profile、下载 host 策略、归因/零行/覆盖语义分别验收。当前 `campaign-report-contract.ts` 和 acquisition transport 明确保持 `liveEnabled=false`。
2. 单独设计正式调度、lease 续期、Attempt/DomainState、长时间轮询、失败重试与恢复策略。当前只持久化请求阶段，不声明已完成后台运维接线或 freshness 覆盖证明。
3. 当前拒绝空报告，不清空历史；缺失指标保留 null，缺少日期不证明完整覆盖。尚未支持 V1 多分片、全历史回补、其他报告类型或写回广告对象。
4. 文件事务失败可能留下孤立对象；没有自动清理。T05 已为当前 local/S3(R2) driver 增加有界读取，但未实测生产对象存储实现的内存/P95；保留期与安全清理方案仍待设计。
5. T06 精确保留成功 create/poll 的 body 字节；失败 HTTP/合同响应只保存固定错误码，不归档失败正文。对象存储写入与数据库事务之间仍可能产生孤立对象，需在保留策略审阅后处理；当前不自动清理。

报表 API/MCP 查询只能读取已发布版本；Skill 不直接访问数据库，也不把 fixture 作为真实经营结果。广告竞价、预算、状态、关键词、否定词和商品投放的写操作仍须先生成草稿并复用 Agent Gateway 审批，当前没有 Ads 写 transport 或自动执行。

## U1-A / U1-B 增量交付

- `capabilities.ts`/CLI 现区分 `acquisition` 与 query/read/liveAcceptance；Campaign 日报为 `ISOLATED_FIXTURE_ONLY`，真实采集仍 `NOT_VERIFIED`。官方 V1 字段与身份合同未重新核验，T02 继续阻断 live adapter。
- `report-scope.ts` 在现有 Request JSON 保存 scopeDigest；一次性 PG 集成验证同 revision 替换授权时，请求 transport 前停止且已 staging 版本不能发布。无 schema migration。
- StorageDriver 的可选 `getBoundedBuffer` 为 local/S3(R2) 提供 stream 上限，旧 `getBuffer` 保持不变；Ads parser 不接受不支持 bounded read 的 driver。
- 成功 create/poll 的 request/response body 以加密证据保留原字节；文件通过 FileObject 引用，正常 API/MCP 不返回正文或签名 URL。
- 最新验证：报表隔离 PG/Redis 23/23；能力/解析/scope/storage 单测 11/11；TypeScript、定向 ESLint 通过。迁移无 schema 改动；当前用户工作区另有 migration 变更，不将其混入本任务迁移结论。
- 仍未完成：官方合同重核、正式 live adapter、报告专用 BullMQ scheduler/worker、跨 Profile 时区 totals 语义、真实 Profile 数据验收。真实 API、配置和任务保持关闭。

回滚仅回退新增日报入口、采集与发布扩展，保留历史事实和文件。无 schema 变更，不需要数据库回滚。没有执行真实 API、配置更改、持久数据库迁移、同步任务、commit/push 或部署；桌面 commit/push 追溯规则本次未触发。

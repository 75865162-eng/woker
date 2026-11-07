# U1-A：Campaign 报告合同、范围冻结与数据语义决策

日期：2026-11-06

本记录只固化离线实现可以安全依赖的边界。它不是 Amazon 真实账号授权、生产配置或同步启动批准；未决项继续阻断正式 live adapter。

## 版本与身份决策

| 决策项 | 当前结论 | 证据/限制 |
| --- | --- | --- |
| 离线基线 | 使用 Reporting v3 `spCampaigns`、Campaign 维度、DAILY、GZIP_JSON 单文件 | `src/lib/amazon-ads/campaign-report-contract.ts`；隔离 parser 和 acquisition 测试通过 |
| 日期窗口 | 隔离合同最多 31 个自然日，日期按 `YYYY-MM-DD` 严格校验 | 31 天是本地合同上限，不是生产配额或 SLA |
| 指标 | `impressions`、`clicks`、`cost`、归因 purchases/sales/unitsSoldClicks；计数和金额保持字符串 | 未提供值保持 `null`；不把缺失转成 0 |
| 归因 | 离线请求显式选择 1/7/14/30 天，并写入 manifest、requestOptions 和 fact key | 真实账号要再核对广告产品、账号类型和归因成熟周期 |
| 身份映射 | 不把 ERP 内部 Profile ID 当作 `advertiserAccountId`；V1/V3 身份、区域请求头和账号绑定仍待真实合同确认 | V1 与 V3 的账号身份语义不同；live adapter 保持关闭 |
| 正式版本 | 当前选择“暂缓正式接入”：V3 只作为离线基线；优先评估 V1，身份与字段证据齐备后再选择正式 adapter | `liveEnabled=false`，没有默认 live HTTP transport |

证据沿用 [U1 交付记录](./amazon-ads-u1-delivery-2026-11-06.md) 中 2026-11-06 记录的 Campaign v3、Reporting v3 get-started 和 Reporting V1 quickstart 链接。已有文档记录 V3 退出日期为 2027-06-30；本轮没有再次联网核验，不把该日期或 V1 字段映射当作已重新核实的生产合同。V3 直接正式化会产生版本迁移成本；同时实现两套正式 adapter 会扩大测试和身份映射范围，故当前保留一种离线基线及正式阻断。

## 范围冻结与恢复

本批最小存储 diff 为在已有 `ReportRequest.requestOptions.acquisition` 新增 `scopeDigest`，不新增表或迁移，不改变公开 API。初始化报告请求时，`report-scope.ts` 对组织、工作区、请求用户、任务/计划 ID 与 revision、内部/外部 Profile、授权 ID 与 revision、地区、Seller/站点、请求日期、币种、时区及 manifest 合同计算摘要。acquisition 和直接 staging/publish 两个入口均在任务锁内复查摘要，防止同 revision 新授权替换旧授权。预算/deadline 沿用已有 Request JSON；本批不改变其上限。

U1-B 文件读取增加可选 `StorageDriver.getBoundedBuffer`，local 和 S3/R2 使用有界 stream reader；不具备 async iterable 的对象流会失败关闭。旧 `getBuffer` 接口保持兼容，其他调用方行为未变化。Ads 报告解析拒绝不支持有界读取的 driver，并将过大或读取错误压缩为安全错误码；异常大小对象不会交给 parser 或 staging。

采集成功的 create/poll 请求及响应 body 原字节以 base64 包入既有 AES-GCM 加密证据对象，附带内容类型/观察时间；解密后可还原原始 HTTP body。签名 URL 因此仅存在于密文，MCP/API/普通调用记录不返回。HTTP/合同失败只持久化固定错误码，不归档原始失败正文；若未来要保存失败 body，需先确定敏感等级、大小上限、脱敏和保留策略。

旧的 acquisition 若缺少 scopeDigest 则拒绝继续，不从当前绑定自动补签。历史已发布事实继续只读；无 acquisition 的旧通用 fixture 发布路径维持原行为。正常结构 checkpoint 不变。该摘要是服务端意外变更检测，不抵御拥有数据库写权限的人同时改写摘要和数据，也不声称已经为正式任务创建时冻结全部范围。

同一任务使用 `publication:<taskId>` 幂等键。重复初始化复用同一 ReportRequest/Version；create 在响应未知时保留 reservation，禁止自动再次 create。替换 fence 只能继续已知远端报告的 poll/download，不能绕过原任务范围或重新扩大权限。

## 发布与版本选择语义

1. staging 事实不可查询；只有文档、哈希、行数、字段、日期、币种、重复键、任务状态和 fence 全部通过，才在同一事务中把版本置为 `PUBLISHED`。
2. 失败、取消、超时、未知 create、空报告、损坏文件、计划变化和事务回滚均不得替换当前已发布版本；历史版本和原始文件引用保留。
3. 查询先按事实键选择最新成功已发布版本，再应用 Campaign、Ad Group、ASIN、关键词、日期、排序和分页筛选。修订只替代相同事实键；未被新版本覆盖的键不会被臆测删除或归零。
4. `MIN(reportDate)`/`MAX(reportDate)` 只表示已观察日期范围，不表示窗口内每天完整；freshness 也不等于归因最终成熟或全量覆盖。
5. 现有 totals 按币种、报告类型、广告产品、API 版本和归因窗口分组，比率缺少分母时保持 `null`。**现有查询没有按 Profile/时区分组，不能承诺不同时区不混算。** 正式跨 Profile 分析前必须在 T12 提交兼容方案；当前验证限单 Profile，不改变查询语义。

## 四个边界示例

| 场景 | 当前行为 | 原因 |
| --- | --- | --- |
| 空报告 | parser/发布拒绝，旧已发布版本保持可见 | 没有官方合同证明“空”代表整窗口无数据 |
| 新版本缺少旧事实键 | 新版本只替代它实际提供的键；旧键不自动删除 | 当前合同未证明缺行是删除、零值还是报告筛选结果 |
| 迟到归因修订 | 以新版本替代相同事实键，保留旧版本和发布时间 | 修订可追溯，避免重复累计 |
| 不同时区/Profile | 例如洛杉矶与东京的同名 11-01 并非同一 UTC 区间；当前同币种 totals 可能合并，正式分析先要求单 Profile，T12 再补版本时区与分组 | 日期标签不能脱离报告源时区解释；本批只设计，不声称查询防线已完成 |

## 仍需真实验收的项目

- 目标 Ads Profile、区域、账号类型、V1/V3 身份映射和请求头；
- 具体报告可用字段、归因最终化时间、迟到修订周期、空行/warning 和覆盖保证；
- 下载 host 白名单、重定向/DNS 安全、生产限流、保留期和正式 worker 调度；
- 真实样本与 ERP/API/MCP/页面对账。

在这些项目完成独立审批前，能力矩阵中的 `acquisition=ISOLATED_FIXTURE_ONLY`、`liveAcceptance=NOT_VERIFIED` 和 `WRITE_NOT_IMPLEMENTED` 必须保持不变。

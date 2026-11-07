# Amazon Ads 核心闭环：第一批授权连接可靠性

日期：2026-11-06。依据用户《Amazon Ads API 全量数据自动同步：核心闭环实施任务书》及当前工作树。此批已编写本地代码；不表示第一轮真实闭环已完成。

用户后续确认：“现在还没有凭证，先做好架构，最后再输入凭证测试”。因此继续本地代码和隔离验证，不等待凭证，不将此前建议试点作为现在启动真实请求的授权。

## 当前实现与复用

- OAuth code exchange、refresh、NA/EU/FE Profile 发现与加密授权持久化已有实现，复用 `oauth-contract.ts` / `authorization.ts`。
- Campaign、Ad Group、Keyword、Target 和两级 Negative Keyword/Target 共八类读取已有正式结构 adapter，沿 `sync-service.ts` / `sync-scheduler.ts` / `sync-processor.ts` 持久化到 `AmazonAdsEntityRecord`。没有重建任务或实体模型。
- Campaign/Ad Group 业务页已读本地服务端结构；代码存在不证明目标库有真实 Amazon 数据。
- Product Ad 缺 reader；Reporting v1 的通用 transport、持久 create/poll、加密分片存储、GZIP/JSON 语法 reader 已存在，但生产 Campaign 字段合同、正式下载来源、规范化发布与常规报告运行层仍缺失。live dispatch 保持关闭。

## 本批实际代码

1. `oauth-contract.ts`：新增 `AmazonAdsConnectionError`，继承既有 `AdsSyncError`，使结构 worker 自动按明确的 retryable 分类处理令牌刷新失败。保留操作、区域、HTTP 状态与安全错误码；不附带响应正文、Token、URL 或异常 cause。
2. 401/403/其他非 429 的 4xx 不自动重试，429/5xx、网络失败和超时允许进入既有受限重试；解析 `Retry-After`，本 transport 不内部重发请求。
3. 20 秒总截止覆盖 fetch 与读取响应体；拒绝重定向。实际流式计数限制 Token 回执 64 KiB、Profile 回执 4 MiB，拒绝非法 UTF-8/JSON 和空/含控制字符的 Token。以上为本地保护上限，不是 Amazon 官方额度。
4. 拒绝超出 JavaScript 安全整数精度的数字 Profile ID，避免绑定已舍入的身份。字符串 ID 仍保留原值；没有猜测/修复超大 JSON 数字，遇到此类真实返回应补充官方合同与保真解码后再验收。
5. `authorization.ts`：全区域发现均失败时优先保留 consent region 的受控连接错误；部分区域成功继续保留既有行为，不擦除失败区域历史 Profile。OAuth 回调只透传受控连接错误，其余错误仍使用原有脱敏消息。

没有新增数据库字段、迁移、权限、API 路由或调度入口。没有把配置成功、Profile 发现成功或文件存储成功作为日报发布成功。

### 第一轮执行编排

新增 `connection-probe.ts` 的 `probeAmazonAdsConnection`，显式注入既有 OAuth、结构 reader 和逐请求 `authorize` 函数，固定顺序 refresh → profiles → campaigns → ad-groups。默认不提供生产调用方或网络装配，不读取环境变量/密钥，不访问数据库和队列。调用方后续需把 authorize 接入既有实时权限、账号绑定和批准范围校验后才能用于真实验收。

- maxRequests 必填、1–4，每次授权后、实际调用前先占预算，失败请求也计数，无内部重试。
- 没有明确选定 Profile 且发现多个账户时返回 PROFILE_SELECTION_REQUIRED；零账户或指定账户未被发现则阻断，不随机选账户。
- Campaign/Ad Group 各仅一页，复用现有 SP reader 和 page validator；仍有游标时标 READ_PARTIAL，不跟随下一页，不把局部数据标为全量。
- 结果只返回 Profile 必要元数据、实体 ID/数量、是否有下一页及受控失败码；不返回访问令牌、刷新令牌、原始 payload 或游标。
- READ_COMPLETE 只表示这次受限协议读取完成，始终 persisted=false，不代替同步 worker，不绕过入库、lease/fence、幂等和发布机制。
- 这一步不新建第二套同步任务、恢复游标或事实表。正式入库仍使用现有结构 worker；有界 probe 只为最后接凭证时验证第一轮协议可连接。

## 验证

- `node node_modules/tsx/dist/cli.mjs --test tests/amazon-ads-authorization.test.ts tests/amazon-ads-sync.test.ts tests/amazon-ads-reporting-v1-transport.test.ts`：40/40 通过，全部注入本地 Response/stream，不访问外网。覆盖现有区域/header、身份隔离、结构分页与 V1 阻断回归，以及新增不安全 ID、错误脱敏、重试分类、响应体限额及 stalled body 超时取消。
- 三个本批源/测试文件定向 ESLint：通过。
- `npm run check:fast`：单元测试阶段失败，尚未进入全仓 lint/typecheck。日志 `/tmp/ads-core-closure-check-fast.log`。其中 Agent/Market/Selection 多个文件因工作区 `src/lib/integrations/sellersprite.ts:105` 非法字符不能编译，另有 `selection-research.test.ts` budget reservation 断言失败；这些不属于本批范围，未修改。
- 独立 `tsc --noEmit`：被上述 `sellersprite.ts` 语法错误阻断，不声称全库类型检查通过。未运行完整 build/check、数据库/浏览器集成：本批没有改 UI/schema，且全库基础检查先有阻断；合码前应在相关工作树修复后完成共享检查与构建。
- 新增编排专项 `tests/amazon-ads-connection-probe.test.ts`：7/7 通过，覆盖逐步授权/撤权、预算、账户歧义/不在发现结果、分页截断、脱敏、429不重试、调用方变更隔离，以及现有正式 SP reader 的注入 HTTP 组合。没有网络、真实 DB 或凭证。最终合并专项结果以本批末尾追加记录为准。

## 真实验证等待范围确认

尚未读取凭证、配置真实环境、调用 Amazon、创建真实任务、写入真实 PostgreSQL、执行 migration、commit/push 或部署。工作区已有其他窗口大量改动，保持原样；未同步 GitHub，不声称两端已对齐。

建议第一步只验证协议可连接：用户指定隔离数据库/专用环境、已授权测试账户、区域及一个 Profile；最多 1 次 refresh、1 次该区域 profiles、Campaign/Ad Group 各 1 页，总计至多 4 次请求、串行、无内部重试，不创建报表、不改远端广告。请求/网络成本未知，不假定为零；大于一页不标完整同步。

这一协议验证不自动授权任何真实配置/数据库写入。若下一步需要在测试库运行完整持久任务，应先审阅该库、组织/workspace/Profile、页数/任务预算与写入范围，再单独批准；不得用常规自动任务替代四请求上限的协议验收。凭证沿现有安全配置，禁止聊天/文档粘贴。

## 下一步与回滚

收到精确真实验收范围后执行连接与实体抽样，记录实际返回数、分页截断及失败原因；在缺授权时仅继续本地编写。Reporting v1 继续按官方业务合同补证，不将现有 V3 fixture 字段套用到 V1。历史回补/增量/MCP 全量验收仍未完成。

本批回滚只撤销 `oauth-contract.ts`、`authorization.ts` 中本批连接诊断改动及对应测试/文档，保留其他窗口在 `authorization.ts` 的 advertiser account CAS 等改动。无数据库回滚。新增截止与大小限制可能拒绝特别大的正常 Profile 回执；此时明确报 RESPONSE_LIMIT，必须依据真实证据评估后调整，不静默截断。

新增 probe 模块可直接移除，当前无生产调用方；不影响现有结构 worker。后续在没有凭证时可以继续补正式报告合同和运行层，但完整五轮、历史/增量和真实 API→PostgreSQL→ERP→MCP 验收仍未达成，不能由本批代码推导完成。

最终专项复验：授权/连接编排/SP 同步/V1 transport 合并 48/48 通过；五个本批源/测试文件定向 ESLint 通过。补充测试确认忽略 AbortSignal 的 fetch 在截止后才返回时，其迟到响应体也会取消，避免继续消费资源。全仓 check:fast 原执行为 939 项、932 通过、7 失败（含文件级编译失败）；不与本批专项统计混用。未机械重跑已被其他模块阻断的全库类型检查，也未运行完整生产构建。

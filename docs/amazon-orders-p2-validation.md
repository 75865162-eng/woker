# P2 离线验收记录（2026-11-05）

结论：Orders v2026-01-01 P2 详情实现通过本地隔离验收。用户明确批准新版官方 PII 契约：LWA + 已批准 restricted roles，不使用 Orders RDT。未访问真实 Amazon/LWA、真实凭证、生产 DB/config，也未运行生产迁移、同步或部署。

| 检查 | 结果 |
| --- | --- |
| `npm run test:amazon-orders:offline` | 通过：58 单测/回归 + 12 临时 PostgreSQL 集成 + 3 本地 mock 浏览器测试 |
| P2 业务覆盖 | 列表多页 + 按单详情、精确金额字符串/NUMERIC、敏感 raw 加密、普通查询无 PII、幂等重放、列表完成后待处理详情恢复、事务回滚、冻结范围授权零 HTTP |
| HTTP 错误 | 400/403/404 不重试；429 记录 request ID、限流头并退避；500 有限重试；测试时推进 fixture 时间，不调用真实 Amazon，不做真实 sleep |
| `npm test` | 736/736 通过 |
| `npm run typecheck` | 通过 |
| `npm run lint -- --ignore-pattern '.next-amazon-live/**'` | 0 错误、5 条既有 warning；均在无关模块 |
| Prisma validate/generate | 通过临时配置；离线 runner 将 P2 migration 应用到临时 PostgreSQL |
| `git diff --check` | 通过 |

浏览器用例验证未完成窗口、UTC/null、403/空态、分页、来源任务，以及 P2 列表完成但详情待补齐、详情补齐完成、超 JS 安全整数的金额原始字符串展示。新增 P2 用例没有真实 sleep；已有旧回归中的本地锁等待不冒充新增行为。修改文件的专项 ESLint 为 0 错误/0 警告。

测试 runner 使用仓库 fixture、`.invalid` 的注入 HTTP、每次随机命名临时 PostgreSQL/Redis 和临时目录；不加载 dotenv、不继承真实凭证/数据库 URL，不下载镜像，并用 network guard 拒绝外联。浏览器由 Playwright `route.fulfill` 接管全部页面和 API 流量。

没有运行 `npm run check` / 生产构建、E2E 登录、线上页面、真实店铺同步、数据库生产迁移、配置应用、PR 推送或部署。完整 CI 与 migration review 只在工作区范围厘清且准备合并时执行；生产操作仍需单独明确授权。

已知产品决策待确认：PII/raw 保留期和授权访问角色；生产每个绑定只选择必要的数据集并按 Amazon PII 文档核对 FBA/FBM、国家、状态和逐字段角色条件；订单收入使用 `proceeds.grandTotal` 还是其它业务定义；窗口订单上限和详情调用预算；P1/P2 PR 分界。应用暂不提供明文 PII 查看、导出或 raw replay。

## 原任务自检（截至 P2，非 P5 最终验收）

| 条目 | 是/否与证据 |
| --- | --- |
| 三类新同步都能隔离跑通 | 否；本阶段仅订单，财务/退货留待 P3/P4 |
| 没有真实网络/凭证参与同步测试 | 是；环境白名单、外网 guard、fixture fetch、一次性 DB；公开官方文档只读核验不属于业务同步 |
| 全部新端点有官方链接/版本 | 是；`getOrder` 客户端注释和 P2 PR 草案列明 v2026-01-01 官方参考 |
| 幂等重放通过 | 是；订单/商品/work 行数不增，同版本不重发详情 |
| 断点续传通过 | 是；最终列表页后详情失败，新批准 run 仅处理 pending 单 |
| 403/429 行为符合预期 | 是；403 单次失败，429 持久化退避与 bucket 冷却 |
| 金额/时区断言通过 | 是；原字符串、Decimal、UTC 偏移、null 与未知状态测试 |
| 日志无 token/PII | 是；合成 fixture 的私密 sentinel 未出现在日志/错误/查询/明文事实；不读取真实日志 |
| 轮换/年度重授权写入文档 | 是；README、P1/P2 计划明确保守运维周期 |
| 待人工确认清单 | 是；P2 计划与本记录列出数据集、角色用途、留存、金额口径和预算 |

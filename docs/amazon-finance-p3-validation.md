# P3 财务离线验收（2026-11-05）

P3 本地实现已完成。用户明确批准卖家级采集范围扩展；P4 尚未开始。官方契约、文件级计划及决策记录见 `amazon-finance-p3-plan.md`，PR 描述见 `amazon-finance-p3-pr.md`。

## 验证路线与证据

- `npm run test:amazon-finance:offline`：**73 单元测试 + 22 财务 PostgreSQL 集成 + 3 Orders 浏览器 + 2 财务浏览器通过**。单元集合包含 15 项财务新测试及共享授权/旧资源回归；DB 集成通过真实申请→批准→应用→processor，但 transport 使用仓库 fixture。
- `npm run test:amazon-sync:offline`：扩展旧三链路、P1/P2、销售链路、权限/MCP、queue/worker/本地浏览器与财务回归。最终完整回归 **73 单元 + 95 数据库集成 + 5 浏览器通过**，包括新增手动重试、途中撤权与预算专项；fixture runner 退出码 0。
- 全仓核心测试：**751 通过**（随后新增的财务并发刷新专项由财务离线命令覆盖）。
- `npm run typecheck` 通过；全仓 ESLint 排除已有 `.next-amazon-live/**` 生成目录后 **0 errors / 5 既有无关 warnings**；P3 涉及文件专项 lint 无错误。没有修改全局 lint 配置或删除旧目录。
- Prisma generate 使用临时 fixture datasource 配置，不加载 dotenv；迁移只应用至 runner 新建的 PostgreSQL 容器，验证旧 schedule 保留且停用。`git diff --check` 通过。
- 本机 Node **24.18.0**。解析器不依赖 Node 24 reviver `context.source`，但当前没有独立 Node 22 可执行文件；Node 22 CI 运行仍是合码门槛。未下载运行时或依赖。

runner 只传白名单环境变量，禁 dotenv；预装 PostgreSQL/Redis image 使用 `--pull=never` 创建新容器、随机 loopback 端口。网络 guard 在应用 import 前禁止未 mock fetch、外部 DNS/TLS/socket，只允许本次临时 DB/Redis；浏览器 `route.fulfill` 覆盖并核验 loopback origin。新财务测试没有 sleep，重试通过调整临时 fixture 时间/调度字段验证；仅 runner 本地服务就绪检查沿用既有方式。公开官方文档只读核验不属于 SP-API 业务调用。

## 关键行为

| 场景 | 证据 |
| --- | --- |
| 金额与时区 | 原始 `9007199254740993.123456789012345678901234567890` 与负数尾零、指数金额保留；PG NUMERIC 与 FX 明确舍入断言；offset 入账转 UTC；浏览器展示不转 Number |
| 分页与空页 | 保留 postedAfter/postedBefore，nextToken 单独变化；空 transactions 有 token 继续；null token 完成；重复页/交易/循环 fail closed |
| 续传与幂等 | 第 2 页 403 停止，fixture 模拟显式授权重验证后新 run 从第 2 页继续；400 后审批手动 retry 保留原页；同批 fixture 重放两次仍 3 行；新观察更新未知状态且行数不变 |
| 授权与隐私 | 跨 client 并发 20 次只一次 LWA mock，55 分钟后只再刷新一次；角色、区域、参与站点、actor/approver、站点绑定变化均零 HTTP；请求途中撤权无事实/raw 提交；PII/上游错误内容不进入查询或结构日志 |
| 卖家级范围 | 请求省略站点；fixture 站点 B 数据不会落入锚点 A；未知归属加密隔离，普通查询排除；seller/site 越界整页不提交；非管理员站点 grant 看不到财务 source/run/facts |
| 重试与预算 | 400/403/404 不重试；429 计数/退避/blockedUntil；500 最多 3 次；实际响应 RequestId 落结构日志；较低配额头收紧持久桶；无 token 预算时零 HTTP 让出 worker |
| 原子性与解绑 | 临时 trigger 使 raw 写失败，事实、raw、页面、cursor 进度一起回滚；停用 finance source 取消任务/fence、保留密文游标 |

## 阶段自检（是/否 + 证据）

| 原始自检项 | P3 结论 |
| --- | --- |
| 三类新同步均隔离跑通 | **否**：Orders、Finance 已验；Returns 是待确认 P4，不能提前宣称完成 |
| 无真实网络请求与真实凭证参与 | **是（业务同步/测试）**：fixture fetch + 网络 guard + 临时库；没有真实 SP-API/LWA/任务/凭证；官方公开参考页读取另有记录 |
| 新端点均有官方链接/版本 | **是**：client/adapter/processor 注释与 PR 草案明确 v2024-06-19 和 listTransactions 官方 URL；没有 v0 财务路径 |
| 幂等重放 | **是**：第 2 页失败恢复与同批 2 次、3 行断言 |
| 断点续传 | **是**：新 run 和同 run 手动 retry 均保留第 2 页 token |
| 403/429 行为 | **是**：403 停止且授权异常须验证；429 退避与限流桶断言 |
| 金额/时区 | **是**：unit / PostgreSQL / browser 三层断言 |
| 日志不含 token/PII | **是（fixture 范围）**：错误 payload 中的 fixture-secret/access/private 描述不在 error、DTO 和 task logs；raw/quarantine 仅密文，没有读取真实日志 |
| secret 轮换/年度重授权文档 | **是**：README 明确 180 天、年度重新授权；未实际轮换 |
| 待人工确认清单 | **是**：下表；范围方案 A 已确认，不再反复要求确认同一范围 |

## 待人工确认与交付限制

1. 生产 FX 来源、币种、版本、有效期、精度/舍入；无配置保留原币并标 UNCONVERTED，不隐含 1:1。
2. 安全延迟和重叠回查具体配置，以及超出重叠区间的 DEFERRED 后续更新对账口径；posted 窗口不是最终结算完整性证明。
3. raw/隔离记录的保留期、访问流程、容量与生产事务/P95 预算；当前不提供 raw 自动重放/解密下载入口。
4. 返回缺 transactionId 默认整页停止不推进；缺 seller identity 也 fail closed，不生成假唯一键/卖家归属。
5. 所有批准站点当前需同一 ERP sellerAccount；跨 ERP 店铺分摊和非管理员财务访问须另行范围设计，不能默许。
6. 工作区混合改动尚未提交/推送，GitHub PR 尚未创建；P3 PR 草案可审阅。拆分各阶段 PR 和两端同步仍待明确盘点范围，不静默包含他人改动。
7. 未执行生产迁移、任务、配置写入、部署或完整生产构建；合码前需 Node 22 CI、生产构建及迁移人工审核。没有复用生产账号做 E2E。
8. P4 退货仍须按 Reports 链路确认 reportType、行字段和原因口径后实施；本阶段结束等待确认。

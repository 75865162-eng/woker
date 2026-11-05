# Amazon Ads 窗口 E 规划评审

更新：2026-11-06。评审输入为 Downloads 中的 `05-窗口E-变更网关与MCP.md`。附件的角色、路径白名单和实现步骤视为待评审方案；本文不启用真实 Ads 写入，也不代表外部账号或生产系统已验收。

## 当前仓库边界

- `src/lib/agent-platform/amazon-ads.ts` 已注册 `amazon.ads.recommendation.plan` 与 `amazon.ads.recommendation.apply`；应用操作要求已批准且未过期的 Agent approval，并委托持久化审计服务。
- `src/lib/agent-platform/amazon-action-audit.ts` 与 `AmazonAgentActionAudit`、`AgentApproval`、Agent execution/trace/event 已承载当前 PPC Ads 预览、人工审批和审计闭环。当前正式预览只开放 `update_bid`，最多 100 项；来源 report 中的 row ID 还未验证为 Amazon entity ID。
- `src/lib/amazon/ads-client.ts` 有 Sponsored Products v3 请求构造和结果解析，但没有 HTTP transport。执行开关打开时仍被 `NOT_IMPLEMENTED` 闸门阻断，不会发出 Amazon 写请求。
- `src/app/api/mcp/amazon/route.ts` 当前认证的是个人 Amazon MCP 凭证，只开放有范围约束的 SP-API 读取工具。它不是 Ads 写入口；不得把 SP-API 凭证或数据权限等同于 Ads Profile 授权。
- `src/lib/amazon-ads/decision-demo.ts` 是纯演示状态机，支持草稿、模拟审批、逐项模拟结果和逆向草稿；它没有持久化或外部执行能力，不能复用为正式服务端 gateway。

## 评审结论

| E 文档提议 | 结论 | 落地方式 |
| --- | --- | --- |
| 写操作只能通过受控网关；先 dry-run、人工审批、再执行 | 合理，保留 | 复用现有 Agent Tool Gateway、`AmazonAgentActionAudit`、`AgentApproval` 和权限检查；不得新增可绕过审批的页面/MCP直写路径 |
| 执行前保存状态、幂等、逐项结果、审计、逆向动作 | 合理，需补协议 | 以稳定 Amazon entity ID、Profile/卖家/站点范围、批准版本和实时当前值为依据。逆向动作是新草稿，重新审批，不改写历史 |
| 先 mock、先写护栏测试、日志脱敏 | 合理，保留 | 使用仓库现有单元测试及隔离数据库/队列 harness；禁止真实凭证和真实 HTTP |
| 新建 `change_orders`、`change_audit`、`entity_snapshots`、`recommendations` | 不直接照搬 | 现有 Agent execution/approval/audit 已有事实源。先确定当前模型的缺口；若确实无法表达多动作及逐项结果，再提交最小扩展方案，不能并行维护两套审批/审计 |
| 新建 `backend/app/gateway`、`backend/mcp` 和 `win_e_*.sql` | 与仓库不兼容 | 本项目使用 `src/lib/agent-platform`、Next Route Handler、Prisma 和时间戳迁移目录；沿用现有模块，不复制另一套运行栈 |
| 固定 `/api/ads/change-orders` 接口和独立 MCP 服务器 | 尚未证明需要 | 先核对 `/api/agents/*`、`/api/mcp/amazon` 和现有工具调用/审批流程。若要增加 Ads MCP 工具，需独立定义 Ads 授权、Profile 范围和写权限，不把 SP-API MCP token 扩成隐式 Ads 写凭证 |
| 同一服务端事务内完成网关、外部调用、审计 | 不可采用 | 外部网络调用不能放在长数据库事务里。应先原子认领/冻结审批版本，再在事务外执行一个有界 HTTP，最后用幂等键和版本条件记录逐项结果；超时结果未知时必须停下来对账，不盲目重放 |
| profileId、entityId、动作值由 MCP/UI 参数传入 | 不可信任 | 服务端必须从当前身份及已绑定 Profile/卖家/站点授权推导可访问范围；逐条核对 entity 所属 Profile、类型、父子关系及状态，不接受客户端声明扩大范围 |
| 断货/Buy Box 通过 `asin_daily` 强制保护 | 当前数据边界不支持该实现 | 仓库没有规划中所指的 `asin_daily` 通用表。经营事实必须按组织/工作区/卖家/站点/日期/币种/来源版本匹配；一个活动可有多个 ASIN。缺失或过期时风险增加动作应拒绝或只生成警示，不能推断整个 Campaign 安全 |
| 统一 ±20%/日累计 ±30%、6 小时冷却、7 天 50 美元门槛、失败率/花费熔断常数 | 不能直接成为硬规则 | 目前 bid 校验范围和警告口径不同，账户/站点/广告类型限制也未完整核验。先确定权威配置、单位/时区、统计窗口和审批版本；策略配置应有权限、审计和不可删除的系统安全下限 |
| 阈值内自动批准（默认关闭） | 暂缓 | 当前正式 Ads 变更要求人工审批；打开 Ads execution 环境变量也不会绕过未实现闸门。任何自动放行必须单独评审角色、范围、限额、熔断、事故恢复和授权，并经明确批准 |
| 归档实体一律不能回滚 | 需官方契约核实 | 归档/删除/状态转换的可逆性因实体类型和端点而异。未知时拒绝回滚；已执行变更的逆向草稿仅针对明确成功项，并校验远端当前值没有变化 |
| 固定注册 9 读 + 9 写工具 | 数量与公约不一致，且超出本阶段 | E 附件验收写 9 读 + 10 写；公约与前置规划列出 9 读 + 10 写。先统一名称、数量、权限和用途，再按最小能力增量注册。当前系统不具备这组 Ads 读工具的完整服务端数据合同 |

## 尚缺的正式合同

当前仅有出价预览路径，不能把 E 文档的通用动作直接映射为现有实现。正式化前至少要定义：

1. 受控主体：organization、workspace、actor、Ads authorization、Profile、ERP seller、marketplace 的绑定与实时撤权检查。
2. 稳定实体身份和字段合同：真实 Amazon entity ID、实体类型、父级 ID、币种/单位、站点限制，以及每个动作对应的官方 API 版本和部分更新语义。
3. 状态机和并发：draft、submitted、approved/rejected、executing、partial result、unknown outcome、completed/failed、inverse draft；每次状态转换都校验 revision、到期和幂等键。
4. 审批：使用现有 Agent approval 权限体系；阈值自动审批保持关闭。批准应绑定不可变动作摘要、范围、证据时间戳和策略版本。
5. 结果与恢复：每个动作记录请求前后值来源、调用结果、上游 request/correlation ID（脱敏）、重试分类和核查状态；未知超时不得自动再次写入。
6. 回滚：只为已确认成功且远端当前值仍匹配执行后状态的动作生成逆向草稿；创建类动作需另定义补偿，不伪称普遍可逆。
7. MCP：若要向个人 MCP 暴露 Ads 能力，需拆分只读工具与写工具授权、Ads Profile 范围、调用身份、当前 ERP 权限和审批引用；每个写工具只能提交草稿或调用已批准流程。

## 建议的渐进落地

1. 保留现有 `update_bid` preview → human approval → apply audit 入口；先补齐 Profile/entity ID 与远端当前值核验，保证预览不把 Bulk row ID 当 API entity ID。
2. 在 mock transport 下为单一已核验动作完善持久化状态转换、逐项结果及重放/未知结果测试；正式 HTTP transport 继续关闭。
3. 只有当单动作验证通过后，才评审是否需要通用多动作聚合、可配置护栏和快照存储；用现有模型能表达的内容不增表。
4. 最后以显式 Ads credential scope 增加 MCP wrapper；默认只读/预览，人工审批和执行策略由服务端强制，未经批准不启用实时写入或自动批准。

## 定向验证

2026-11-06 运行 `npx tsx --test tests/amazon-ads-decision-demo.test.ts tests/amazon-action-audit.test.ts`，11/11 通过。期间只修正了两条测试正则，使其匹配现有的人工补偿与 AI 证据错误文案；未改动 gateway 逻辑、权限、数据库或外部调用。未运行全仓 `check:fast`，因为本轮实现限于规划评审、演示单测断言和文档。

## 影响与回滚边界

把正式 gateway 扩展到多动作会影响共享 Agent 权限、审批 API、数据库模型、后台 worker/MCP 契约，并可能产生真实广告花费副作用。应先提交逐项范围、权限变化、数据库兼容、失败/部分成功处理、回滚与隔离测试方案，再开始修改。回滚仅能撤销本次代码/配置兼容层；已执行的外部广告动作不能靠数据库回滚撤销，必须另行提交经校验和审批的逆向动作。生产凭证、真实请求、数据库迁移、配置启用和部署不在当前评审范围。

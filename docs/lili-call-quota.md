# ERP / Lili 共享调用额度

入口 `/lili/v2/recharge`（Lili 导航“充值”），读取 `/api/lili/call-quota?page=1`。页面和 API 均要求 `agents:view`，只展示当前认证组织、ERP 用户自己的余额和分页流水，不能传用户 ID 读取他人。ERP 登录与 Lili OAuth/Bearer 都映射同一 ERP userId；同组织跨工作区共享，组织之间隔离。旧独立 Lili 演示数据库和供应商账户积分不迁移、不充值。

`MarketCallAccount` 是内部次数余额事实源；`MarketCallEntry` 保存调整、预扣和最终状态。真实选品研究通过 `researchAccess` 注入同一账本：研究任务首次付费请求经页面审批后，同一任务后续付费只读调用在已保存的任务/工具上限内继续运行；每笔请求仍写入独立的调用记录和授权关联。每次实际请求发出前预扣 1 次，账户行锁保证跨任务/设备/来源并发不能透支；callId 唯一防重放。目录发现、Skill 和 ERP 读取、隔离样本不扣次。任务首次授权不改变账本余额，不表示供应商免费；账户余额和任务硬上限不足时不发请求，也不弹出额度增加审批。

每个同事账号各自独立开户，不共享其他同事余额。账号管理/Excel 名册同步（`syncRosterLoginUsers`）、自助注册、本地账号资料补建、管理员 seed 在新建组织成员时，同原成员写入原子建立余额为 0 的账本；开户失败时不留下无账本的新成员。在线入口通过 `member-call-account.ts` 复用现有事务，独立同步调用则对成员与账本写入使用短事务；SQL `ON CONFLICT DO NOTHING` 兼容正在运行的开发进程缓存的 Prisma Client，也会为经授权保存的旧成员补齐缺失空账本。seed 新进程使用 nested create。编辑资料、重置密码、停用/恢复及重复同步不会重建账本或重置原余额、流水。新增默认 0 次，账号 1 已授权的 10,000 次只属于账号 1，不作为同事默认额度。未启动真实 seed、注册或名册同步来验证，测试使用隔离账号。

明确 `ToolNotDispatchedError` 退回 1 次；发出后成功/失败均扣次，超时或响应不确定保留扣减并标记 UNKNOWN。进程中断或结算写失败保留 RESERVED，页面显示待核对，日志仅输出 `MARKET_QUOTA_SETTLEMENT_PENDING` 与 callId；不得自动退款或重放。人工先对照对应研究 callId、dispatch 和供应商记录确认，再按经批准的维护方案补记；不能仅凭旧 RESERVED 或超时判断未发送。研究页面对每笔市场调用保存 provider、工具、精确参数、发送/响应状态、费用状态及任务授权 ID；确定成功的请求不再等待逐笔费用核对，费用未知仍作为 UNKNOWN 展示。未知结果会暂停，防止不明状态下重放。退款后的流水 delta 为净扣减 0、余额快照为退款时余额，行中说明已退回 1 次。

## 本地启用与维护

新增迁移 `20261107040000_market_call_quota` 只创建两张表、约束和索引，不给所有用户默认额度。账户维护只限有效 owner/database_admin；没有面向模型的充值工具或前端充值写接口。未分配额度账号余额为 0、市场请求被阻止。正式记录保留历史调用数据，不回溯扣减历史请求。

先核对根 `.env` 目标、数据库身份、迁移差异与用户组织绑定，按批准环境执行迁移。首次账号 1 的授权额度为 10,000 次，只执行一次；不是代码默认值，不自动给其他环境账号发放。

```bash
node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/lili/set-call-quota.ts --organization-id=<org> --user-id=<ERP-user-id> --actor-user-id=<owner-id> --balance=10000 --expected-balance=0 --request-key=<unique-approved-operation> --note='经用户批准设置调用额度'
```

默认只读预览，人工核对后同一命令添加 `--apply`。相同 request-key 重复执行不会重新发额度；expected-balance 防止覆盖并发消费。调整和 AuditLog 同事务提交。真实维护需遵循仓库审批规则，不把本机初始化命令当作生产执行授权。

## 验证与回滚

`node scripts/test-market-call-quota.mjs` 使用新的、带唯一标识的临时 PostgreSQL 容器和 mock 请求，不加载 `.env`、不继承真实凭据，仅删除本次创建且标识匹配的容器。覆盖迁移约束、并发扣减、防重复、退款幂等、组织/用户隔离和调整审计。`tests/market-call-quota.test.ts` 验证审批在扣次之前、余额/数据库不足不发送、未发送退款和超时保留。

相关测试、lint、类型检查后，在本机页面验证真实初始化额度；不为验收发出付费请求。不启动 Worker，不修改供应商配置，不部署服务器。

回滚先暂停真实市场调用入口，再撤回本功能代码；保留账本和审计表，不删除真实流水，不退回已消费额度，不让旧版本在未计量状态下继续调用。余额更正需独立获批并使用新的 request-key、当前 expected-balance 留下调整记录。

## 本次本地启用记录（2026-11-07）

已核实根 `.env` 指向本机 Docker PostgreSQL `127.0.0.1:55439` 的 `amazon_sync_live_local`；无 SSH 转发，账号登录标识 `1` 唯一匹配当前组织 owner。确认唯一待执行迁移为本次额度迁移后已应用；使用 `account-1-call-allowance-20261107` 作为幂等调整标识，将余额从 0 设为 10,000，并生成调整流水和审计。页面已核实显示 10,000 可用、0 已扣、0 待核对。验证没有真实市场调用，未修改历史研究任务预算、供应商额度或配置。

隔离 PostgreSQL 并发/退款/审计集成测试、40 项相关回归、定向 ESLint、TypeScript、Prisma schema 校验及 client 生成已通过。原 `RESEARCH_STEP_FAILED_REVIEW_CONTEXT` 未在本任务内修复；新增余额不能替代对该错误的排查。未执行 Git commit/push、服务器迁移、部署或全量生产构建；准备合码/发布时再执行完整 `npm run check` 和 `git diff --check`。

后续补齐同事自动开户：隔离 PostgreSQL 中运行真实 `syncRosterLoginUsers` 验证新账号生成独立 0 余额账本、编辑/停用保留余额和流水、开户失败回滚新成员，以及独立 PrismaClient 调用的短事务路径；自助注册的成员+账本同事务写入形态亦已验证。另有 11 项账号角色、认证和扣次回归、定向 lint、TypeScript 通过。本地只读盘点当前组织成员与账本为 1/1，无缺失需补写，没有新建真实同事测试账号或改动账号 1 的余额。未运行完整生产构建与全站 E2E，本次不含发布。


## 五阶段研究积分修正（2026-11-08）

新任务默认不限任务调用次数，保留旧任务有限授权、账户次数余额及两次业务确认。研究服务费用统一以1研究积分=¥0.01换算，原始供应商单位和凭据保留，未知价格不作零费用。原有调用额度不换算为货币积分。具体接口、数据边界、规划估算、验证及回滚见 [Lili研究积分规则](lili-research-credits-2026-11-08.md)。本节为源码规则更新，不表示已更新已连接MCP服务或生产环境，也未修改真实账户余额。

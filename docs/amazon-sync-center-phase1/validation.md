# Phase 1 验证与验收状态

日期：2026-11-04。结论：全仓 check:fast 与针对性验证已通过；**CI 构建及生产验收待完成，未授权部署**。

## 已执行

| 路线 | 结果 | 覆盖与限制 |
| --- | --- | --- |
| 相关单元／回归 | 58 / 58 通过 | 新中心输入、安全 DTO、密钥绑定、官方更新时间、API 基础错误，以及既有库存、绑定、readiness、计划、读模型、补货回归 |
| 隔离 PG＋Redis 集成 | 14 / 14 通过 | 真 SQL 迁移兼容、复合隔离／活动唯一键、空快照、分页失败恢复、去重、暂停取消、过期租约、旧发布者 fencing、权限撤销、计划冲突／CAS、Redis 队列重建、幂等内容绑定、刊登非法页、循环 Token、1k/5k/10k 容量、真实 BullMQ Worker、授权失效后停用、保留清理保护 |
| 原经营中台浏览器回归 | 17 / 17 通过 | 既有库存／商品／补货／审计／SP-API 设置入口兼容；API 模拟 |
| 浏览器真实样式回归 | 5 / 5 通过 | 七页和旧入口、360px、计划创建／复制／暂停／历史、筛选／分页／重试不冒充成功、只读权限、切工作区丢弃延迟旧响应；API 模拟 |
| TypeScript 全仓 | 通过 | 本机 PostCSS 重复解析修复后，全量 tsc --noEmit 通过，无排除 |
| TypeScript 缩小路线（历史） | 通过 | 初轮临时排除三个既有 PostCSS 类型冲突测试；现已由全仓通过结果替代 |
| 差异检查 | 通过 | git diff --check；新增文本文件另扫尾随空白 |
| Prisma | validate / generate 通过 | 迁移已在一次性 PG 16 应用，旧 schedule 默认版本／key 与 disabled 状态保持 |
| 完整 check:fast | 通过 | 669 / 669 测试通过，lint 与全仓类型检查通过 |
| lint | 通过 | 0 errors；4 条既有警告，分别在通知中心、商品工作台、市场 Agent 和 Sellfox 筛选测试 |

相关测试命令：

```bash
node node_modules/tsx/dist/cli.mjs --test tests/amazon-sync-center-api.test.ts tests/amazon-sync-center.test.ts tests/amazon-sp-api-client.test.ts tests/amazon-inventory.test.ts tests/amazon-seller-bindings.test.ts tests/operations-readiness.test.ts tests/operations-schedules.test.ts tests/operations-read-models.test.ts tests/operations-replenishment.test.ts tests/operations-replenishment-service.test.ts
npm run test:amazon-sync:integration
npm run test:amazon-sync:browser
npm run typecheck
npm run check:fast
npm run lint
```

集成脚本只使用本机预装官方 postgres:16-alpine / redis:7 镜像，新建随机名、仅 localhost 暴露的限额容器；迁移前 schema 固定取审计 commit cd2be5e5fbad8e67f1e565abe1248927ee135515，手工 SQL 约束一并执行。Amazon transport 全部模拟，外部 host 白名单；不存在真实凭证或生产请求。脚本结束清理自己的容器，不清理用户其他容器。

## 初轮阻塞与本轮修复

1. `tests/market-agent.test.ts` 的成功预期依赖旧版模拟数据行为；当前已有的市场 Agent 实现要求真实数据源。测试改为断言未配置时 FAILED、SELLERSPRITE_MCP_NOT_CONFIGURED，无 recommendation、memory 或 output。没有把返回失败改成成功，也没有新增模拟生产数据。该验证修复依赖工作区已有的 `src/lib/agent-platform/market.ts` 修改，不能独立拆开假装 CI 基线一致。
2. 本机 `node_modules/@eslint/eslintrc` 是旧的实体目录，与当前 pnpm ESLint 的依赖解析路径不一致，触发 rushstack patch 识别失败。将该本机入口改为链接到当前 ESLint 实际使用的同一依赖，原实体目录移至临时备份；仓库依赖清单／锁文件／ESLint 配置均未改。
3. 本机根 PostCSS 旧实体目录与 Tailwind 使用的 pnpm PostCSS 不同，导致三个浏览器测试 TS2769／TS2321。同样只修复本机入口，使两方解析到同一份已安装 PostCSS；没有修改那三个测试或排除类型检查。
4. 新中心的两个请求代次清理回调改为命名 invalidate 回调，继续在离开页面时废弃旧响应，同时消除本轮引入的 ref 清理 lint 警告；5 项浏览器回归再次通过。

本机依赖修复没有网络安装、没有更新依赖版本或生产配置。恢复记录为本机临时目录 `/var/folders/r2/1864xtpd0xv8n0z_n47d845h0000gn/T/amazon-sync-dependency-resolution-NmjEM2/restore.json`，列出原入口、实际目标与原实体备份；仅需恢复本机时，先确认对应入口仍指向所列 target，再移除该 symlink 并将 saved 移回 entry。CI 应由干净 npm ci 安装，不能把本机 node_modules 打包发布。

生产 build 遵循既有 CI artifact 构建链路，在整体工作区范围确认后随 PR #3 触发；构建结果以该 PR 的最新 commit 检查为准，不从本地测试推断成功，不在服务器构建。未访问真实账号或生产服务器，真实 SP-API 联调及生产验收仍待授权与运行条件。

## 对照用户 12 项验收

| 项 | 当前证据 | 仍需验证 |
| --- | --- | --- |
| 多店铺、多站点隔离 | DB 复合约束、两 ERP 店铺／两站点、跨组织拒绝、工作区响应隔离 | 独立真实 Amazon 卖家凭证与多工作区端到端联调 |
| 大数据量 | 模拟 1k / 5k / 10k，快照分片与页查询 | 真实 API 页大小、跨卖家容量、50 用户并发、资源预算 |
| 中断恢复 | 已提交页后错误恢复、租约过期／旧执行器禁止发布 | 真实进程 kill、机器重启、数据库瞬断演练 |
| 重复任务 | 部分唯一索引、请求幂等、旧 dispatch 代次无效 | 多进程压力下持续竞争 |
| 限流重试 | 错误分类、退避、分页 503 恢复、持久预算 | 真实 Usage Plan／429／动态头联调 |
| 分页完整性 | 循环页、非法页、页数／行数校验及零行发布 | 真实 Amazon Token 过期、长任务页变动 |
| 去重／迟到更新 | 快照业务键去重，源更新时间与同步时间分离 | 订单／财务迟到更新属后续阶段，未实现 |
| 回填和实时并行 | 分片让出执行槽，计划优先级可配置 | 历史回填未开放，不计验收通过 |
| UI 真实状态 | 模拟真实 API 契约、202 不显示成功、权限／工作区时序 | 页面到真实后台完整联调 |
| 数据源／口径 | 既有补货回归、ProductRecord 无写入、来源显式 | 真实 SKU／条件／币种样本核对 |
| 权限／敏感信息 | 复用权限、租户隔离、actor 撤销、安全 DTO／加密检查点 | 真实角色矩阵、运行日志抽检、加密密钥运维演练 |
| 构建／测试／部署 | 上述针对性测试 | CI build、授权后的迁移／发布／回滚演练 |

## 容量结果解释

原始数据见 capacity-fixture.json。PG 限 1 CPU / 512 MiB，Redis 限 0.5 CPU / 128 MiB，Amazon 模拟每页 1000 行，每档 40 次本机直接数据库页读。实际 Amazon 页大小和网络时延不同；taskDurationMs 包含测量后的页读耗时，不是纯 API 任务耗时；sliceMs 记录实际分片处理耗时。

结果只证明这些 fixture 在安全阈值内完成。进程 RSS 随档位增加，不能据此声称已证明恒定内存或生产 P95；没有浏览器／网络／50 用户负载。提高试点上限或并发前，需要真实 profiling 与容量评审。

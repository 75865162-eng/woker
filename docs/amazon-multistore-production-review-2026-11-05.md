# Amazon 多店铺 / MCP：生产质量复核与增量修补

日期：2026-11-05。复核基线：`a5bf175535a7eb0a6e141f4a1ffb0d79ff585a0c`，分支 `codex/amazon-multistore-mcp`。

## 结论

当前具备继续生产验收的实现基础，但不能判定为“已达到生产级 ERP 上线条件”。此前 CI 通过证明该提交能测试、构建和打包，不证明真实历史归属、官方授权、生产并发性能或运维恢复已验收。本轮静态复核及隔离数据库回归又发现了来源链检查缺口，已在本地修补。

本结论仅覆盖 Amazon 多店铺权限、同步快照及只读 MCP，不是整个 ERP 所有业务域的安全认证。订单、利润、广告等未接入的 MCP 数据域不能标成已交付；既有模块名或同步域枚举也不能代替真实采集器。

## 本轮发现及处理

| 发现 | 修补和可观察行为 | 验证 |
| --- | --- | --- |
| 历史归属报告可能将失败、无完成时间、已清理或任务数据域错配的记录判成 VERIFIED | 增加 `UNPUBLISHED_OR_MISMATCHED_RUN`；销售行额外比较自身 sourceId 与任务来源；保留只读、不推测、不回填 | 在真实 PostgreSQL 中分别构造四类错误任务，报告标为待核查 |
| 历史快照按当前 source.resource 决定读哪张表，没有确认 task.resource 一致及完成时间 | 不一致或没有完成时间返回 409；保留既有未成功 409、已清理 410 | 普通运营通过真实 readTaskSnapshot 对四类异常均拒绝 |
| 当前库存/刊登已发布头仅判断成功状态，未排除没有完成时间或 PURGED 的残留行 | ERP publishedSnapshotScopes、MCP 明细与汇总统一排除 | MCP 库存明细与汇总、ERP published heads 实际查询均为空 |
| 销售 SQL 校验任务域，但没有校验 source.resource 或 PURGED 状态 | 在数据库 WHERE 排除错域来源及清理任务，覆盖日报及复用该 SQL 的导出 | 真实销售查询、历史 taskId 过滤、总数回归 |
| MCP 返回前只比较来源 ID，查询期间同 ID 的绑定版本或身份变化无法被该检查识别 | 比较来源 revision、authorizationId、Seller、Marketplace、resource 及授权 Seller ID/region，任一变化拒绝返回；正常发布新 head 不单独视为绑定变化 | PostgreSQL 表锁阻塞真实库存查询，在途增加 source revision，释放后不返回结果；既有在途撤权回归保留 |

这些修补针对来源证据及并发配置变化，不声称已复现生产数据泄露。未增加 SQL 往返、全库后台扫描、新表、配置或迁移；在现有 SQL 和返回前复核上补条件。缺失完成时间的旧数据可能因此不可见，应核查原始发布证据，不能自动填时间解除限制。

## 修改范围

1. `src/lib/amazon-sync/lineage-audit.ts`
2. `src/lib/amazon-sync/mcp.ts`
3. `src/lib/amazon-sync/read.ts`
4. `src/lib/amazon-sync/sales-query.ts`
5. `src/lib/amazon-sync/snapshots.ts`
6. `tests/integration/amazon-mcp.integration.ts`
7. `tests/integration/amazon-sales-traffic.integration.ts`
8. 本报告 `docs/amazon-multistore-production-review-2026-11-05.md`

无需数据库迁移。API/MCP 工具名及返回字段不变，异常来源读取收紧；只读报告新增原因码。没有修改 ProductRecord、凭证、环境配置、生产数据或现有生成目录 `.next-amazon-live/`。

应用回滚可撤回本轮提交，无数据库逆迁移；但会重新开放上述弱检查。若发现正常数据被拒绝，应先暂停相关入口并核实原始来源证据，避免通过放宽权限或自动补字段恢复读取。生产发布或回滚都需另行批准。

## 本轮验证

| 验证 | 结果 |
| --- | --- |
| `npm test` | 715 / 715 通过 |
| `node scripts/test-amazon-sync-integration.mjs --mcp` | 27 / 27 通过；包含本轮来源链和在途来源版本变化回归 |
| `node scripts/test-amazon-sync-integration.mjs --sales-only` | 5 / 5 通过 |
| `node scripts/test-amazon-sync-integration.mjs --security` | 11 / 11 通过 |
| `npm run typecheck` | 通过 |
| `npx eslint --ignore-pattern '.next-amazon-live/**'` | 0 error；5 条既有 warning |
| `git diff --check` | 通过 |

集成验证使用临时 PostgreSQL/Redis、合成身份和数据，并应用现有六项迁移以演练兼容；外部 Amazon HTTP 为 mock，未连接现有业务库。测试容器已清理，生成目录未清理。

本轮未运行全套浏览器 E2E：未修改 UI，真实 Route/服务/SQL 和并发测试已覆盖变更路径。未运行生产构建、未触发新 CI：构建保留给获准同步后的 CI。前次提交的 CI 结果不能冒充本轮补丁的 CI。未执行性能 benchmark，不从夹具毫秒数推断生产 P95。

## 生产验收门槛与未解决事项

| 项目 | 当前证据 | 上线前还需要 |
| --- | --- | --- |
| 个人 MCP、显式授权交集、撤权、站点/组织隔离 | 服务/Route/SQL/隔离并发回归已通过 | 在批准的测试目标上用实际运营账户做验收 |
| 历史数据可信归属 | 具备只读报告及拒读规则，没有真实库报告 | 明确目标 org/workspace，只读盘点异常；逐项核实证据与处置方案，不猜 SKU 归属 |
| OAuth 与凭证状态 | 官方地址客户端 + mock HTTP 回归 | 实际 Amazon 应用/权限/区域/回调联调，验证拒绝、撤销和重新授权；单独批准真实 API/配置范围 |
| 性能与容量 | 行数/时间范围/来源数量有上限；未测生产负载 | 按实际数据规模和并发测 SQL/API P50/P95/P99、授权查询开销、审计写入及导出内存，依据结果决定优化 |
| 运维安全 | 代码具有审计、迁移及 CI artifact 边界 | HTTPS、网关限流、审计容量/保留/告警、备份恢复和迁移/应用回滚演练；各项按明确环境审批 |
| GitHub/main 集成 | 既有草稿 PR #5 基于原工作分支 | 本轮补丁同步后运行新 CI；与 main 的历史基线差异需独立审核，不能直接换基线合并 |

本轮没有给出上述真实环境项目已通过的结论，也没有授权执行迁移、部署或配置修改。只读报告仍有 10,000 行上限和 truncated 标记，大规模历史盘点需要按可审阅范围分批处理；它不是全库已净化的证据。

## 本轮 GitHub 同步待审方案

本轮新增补丁超出上次批准的固定文件/哈希清单，尚未提交或推送。依据 AGENTS.md 的长期审批规则：范围变化必须重新提交具体方案。本地代码与验证已经准备完成，审批只针对外部同步。

拟将上列 8 个文件作为一个后续修补提交，推送到现有 `origin`（`github.com/75865162-eng/woker`）的 `codex/amazon-multistore-mcp`，更新草稿 PR #5 的补丁/验证说明；保留 PR 基线 `cursor/rebrand-tiaotiao-aa9a`，不合并 main。

批准后先重新完整检查 `git status --short` 及 diff；若出现上列范围外的新增业务改动则停止并说明。逐路径暂存上列文件，不使用全量 add、stash、reset，不上传 `.next-amazon-live/`、私有配置或运行态数据。推送后等待 PR CI；如未触发，再运行既有 CI workflow，明确 `deploy_production=false`，构建基线仍使用 PR 原始基线 `42f8c1f785b06812ce1c369e8748a290ddf317a0`。失败则修复/报告，不旁路构建、不部署、不执行真实迁移。

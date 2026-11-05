# P4 FBA 仓收退货验收（2026-11-05）

P4 已按用户明确批准的文件级计划完成本地代码、additive 迁移、fixture、查询/UI 和文档。**P4 专项与完整同步离线回归均已通过；仍未执行 GitHub PR、生产构建/CI 或上线操作。** P5 未启动。官方证据、设计冲突及已批准范围见 `amazon-returns-p4-plan.md`；本地 PR 描述见 `amazon-returns-p4-pr.md`。

## 验证结果与复现

| 验证 | 结果与证据 |
| --- | --- |
| `npm run test:amazon-returns:offline` | **84 单元 + 21 退货 PG 集成 + 7 浏览器通过，退出码 0**。运行日志 `/tmp/codex-p4-offline-final.log`；7 浏览器含 Orders 3、Finance 2、Returns 2 |
| 全仓核心 `npm run test` 等价运行 | 在白名单环境直接执行 `tsx --test tests/*.test.ts`：**763 通过 / 0 失败**；`/tmp/codex-p4-core.log`。没有继承业务凭证环境 |
| `npm run typecheck` | 通过；`/tmp/codex-p4-types-final.log`，包含新增浏览器/集成及 query/UI |
| 全仓 lint | `eslint --ignore-pattern '.next-amazon-live/**'`：**0 errors / 5 既有无关 warnings**；`/tmp/codex-p4-lint-all.log`。未改全局 lint 配置、未删除既有生成目录 |
| `git diff --check` | 通过；覆盖当前 tracked 改动区；新增文件另由类型/lint/对应测试覆盖 |
| Prisma | generate 使用不加载 dotenv 的临时 fixture config；P4 SQL 仅应用到 runner 新建的临时 PG，验证旧 schedule 保留且停用；没有生产迁移 |
| `npm run test:amazon-sync:offline` | **84 单元 + 116 数据库集成 + 7 浏览器通过，退出码 0**；`/tmp/codex-p4-all-recovered.log`。用户恢复 Docker 并授权拉起隔离服务后完成全资源重跑，覆盖 Listings、FBA库存、销售报告、Orders、Finance、Returns、权限/MCP及队列/worker。此前Docker退出造成的基础设施失败已由本次成功重跑解决；未修改业务代码以绕过失败 |

网络隔离：runner 白名单环境、临时随机 loopback PG/Redis，预装 image `--pull=never`，应用 import 前启用 `amazon-offline-network-guard.mjs`。新退货 transport 只允许 `.invalid` fixture host；浏览器全部 route.fulfill 并核验 loopback origin。无真实 sleep，fixture 调整本次临时调度字段。无 dotenv、真实账号/凭证、Amazon/LWA业务请求或真实任务。官方公开文档核验是只读网页检索，另有 evidence JSON。

本机 Node **24.18.0**；未安装/下载新运行时。Node 22 CI 与生产构建未执行，保留合码门槛。没有启动 dev/真实worker，没有登录生产。

## 关键断言

- create → getReport → getReportDocument → GZIP/普通 TSV；BOM/CRLF、引用制表符/换行；空表头报告成功发布零行。原件加密 envelope，哈希校验；产品名/客户评论/签名URL不进明细、查询与日志。
- 重复 fixture 3 行只生成 2 条事实（第一行 quantity=2）；同报告重放行数不变；新 reportId 可保留新证据，但默认查询仍只返回当前报告2行。历史显式报告须已成功发布，未完成批次不可展示。
- 404 poll 保留 reportId、退避并受次数/时限约束；IN_QUEUE/IN_PROGRESS 后可完成；签名下载403/404刷新元数据，不重建报告、不把下载403误认为LWA授权失效。
- 400/403终止，429记录限流与持久 blockedUntil，500最多3次；创建响应不确定保存 intent，之后新 run 也禁止自动重新 create。
- 下载归档后提交一批、取消并创建新批准 run，保持 archiveTaskId/offset且恢复期间**零HTTP**。模拟明细写入失败，事实和 offset同事务回滚；解绑取消关联任务、保留游标。
- seller/marketplace/region/roles改变：零HTTP。途中下载撤销角色：FAILED且**无raw/明细提交**；进入任务前发现授权不符：BLOCKED。跨租户、错误站点grant、撤销成员grant不能读；正确站点grant可读。Orders关联限定相同授权、ERP店铺、站点及租户；筛选与已匹配订单有PG断言。
- offset日期转UTC，另存配置站点时区。数量只正整数；未知原因、含空格的新状态/处置原样保留，空状态为null；错误日历、无offset、缺必需列、坏引号/不合窗口安全拒绝。
- 共享 LWA缓存/单飞/过期测试由84单元集合覆盖；本次FBA报告非restricted类型，不新增Tokens端点或虚构RDT过期测试。

## 逐条自检：是/否 + 证据

| 要求 | 结论 |
| --- | --- |
| 三类新同步在隔离环境跑通 | **是（分阶段/专项）**：P1/P2、P3验收记录；本次P4 21 PG +7浏览器。最终全资源单命令回归84单元+116数据库集成+7浏览器通过；生产发布门槛仍独立 |
| 没有真实网络请求和真实凭证参与 | **是（同步/测试）**：mock fetch、网络guard、fixture临时库；真实Amazon/LWA请求为0。只读官方公开参考页不属于业务API请求 |
| 新端点均有官方链接与版本 | **是**：client注释、批准计划及PR草案列Reports v2021-06-30三操作、FBA reportType官方URL |
| 幂等重放通过 | **是**：同报告重放保持2行；新报告默认查询不累加；PG唯一索引与批次skipDuplicates |
| 断点续传通过 | **是**：404恢复、归档后跨run从offset继续、零HTTP、写失败事务回滚 |
| 403/429行为符合预期 | **是**：API403终止；429退避/限流计数；签名下载403仅刷新文档元数据；具体21集成断言 |
| 金额/时区断言通过 | **是**：金额由同一单元/浏览器集合中的Orders/Finance精度回归覆盖，退货无金额字段；退货UTC和站点时区有unit/PG/browser断言 |
| 日志检索不到token/PII | **是（fixture范围）**：合成错误secret/access/comment及signed value不出现在DTO/事实/task logs；不访问真实日志。原件仅加密；没有报告自由文本明文字段 |
| secret轮换/年度重授权已写文档 | **是**：README明确client secret180天、refresh token年度重授权；本次不实际轮换 |
| 待人工确认清单已输出 | **是**：下表；FBA唯一范围、原件加密/不显示评论、单报告统计已批准，无需重复批准 |

## 待人工确认 / 剩余门槛

1. **基础设施阻塞已解决**：用户手动恢复Docker并明确授权拉起隔离测试服务；全资源重跑退出码0，runner完成临时PG/Redis清理。结束后按 `codex.task=amazon-sync-integration` 标签只读盘点，无遗留测试容器。没有启动应用服务或真实同步worker，没有清理全局Docker资源。此项无需再人工处理。
2. 真实站点的FBA资格/角色attestation、初始窗口、回查、安全延迟、预算和批次值。这里只写fixture策略，未读取或更改真实配置。
3. 实际报告日期若不含offset，需明确格式和站点时区解释后增加解析策略；当前安全拒绝，不能直接声称兼容未经确认的所有实际报告。
4. 退货原因业务归类、数量口径及跨报告对账策略。当前原始代码/quantity/重复行质量标记；没有把不同report叠加为独立事件。
5. raw保留期、解密访问流程与容量/P95预算。原件内存受16MiB限制，投影每批有界但批次会重扫原文；大报告需容量审查。本次不新增解密下载、自动原件清理或任意报告重放入口。
6. Node22 CI、生产构建、迁移锁/索引人工审查及灰度/回滚。未执行 `npm run check` 生产构建或账号E2E；当前为本地开发交付，不是上线批准。
7. 混合工作区包含多个阶段及其他既有改动，未commit/push或创建GitHub PR；已生成P4本地PR草案。正式每阶段PR/两端对齐前须审阅全改动区并明确拆分范围，不能把未批准内容一并推送。
8. P5统一调度、观测与文档收口仍需阶段确认。当前仍是每资源job、逐次审批有界窗口，不自动启用定时采集。

## 本次续跑收口

本轮只更新验收/实施追踪文档，未继续改变业务代码。采用此前763核心测试、TypeScript与lint的等价结果，不机械重复；新完成的全资源离线回归用于补齐上轮唯一环境阻塞，随后 `git diff --check` 通过。无需账号E2E/真实API或服务器操作。Node22 CI、生产构建、正式PR拆分与迁移人工审核仍为独立门槛；P4完成后等待用户明确进入P5。

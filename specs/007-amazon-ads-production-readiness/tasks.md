# 可执行任务清单

最新业务阶段见[U2–U5待优化清单](current-optimization-backlog.md)：U2对应T02/T07–T11及时间合同；U3对应T12/T13/T17–T19；U4对应分析与T20/T21；U5-A对应T15/T16，U5-B对应T22及运维前置。保留以下旧分组及任务完成证据，不重新编号或把规划视为实现。

新增验收要求随原任务落实：T08–T11补初始化/增量/回补、优先级/公平性、跨worker限流、父子窗口与进度；T12补不可变报告时区/日期语义；T13/T17–T19按10页矩阵及通用筛选/历史/导出验收；T20的AI运营入口限制单店铺/Profile及明确日期；T15/T16按十步真实验收顺序记录已有证据和需批准的新操作。具体模型/API差异实施前评审，不在本轮修改代码。

日期：2026-11-06。状态：T01、T03、T04、T05及T06限定范围已有本地交付记录；T02正式合同与后续任务仍按下方条目推进。完成复选框仅对应条目注明的范围，不代表正式账号验收或真实操作已获批准。

需求：[spec.md](spec.md)。设计及门槛：[plan.md](plan.md)。以下是顺序与依赖，不是新增功能已完成的声明。

配套设计：[首批设计与当前基线](first-batch-design.md)、[DC01–DC15 数据案例](data-contract.md)、[U2 空白审批模板](pilot-approval-template.md)。新增案例是 T02/T12/T13 的后续验收输入，不把 T01/T03/T04 的已有离线交付退回未完成；正式能力仍未验收。

## 第一批：U1-A 合同与状态

- [x] T01（FR01）扩展 `capabilities.ts` 及 CLI/消费者兼容测试：区分 Campaign 离线 acquisition、正式采集、官方合同与账号验收；旧调用方不会因此获得执行权限。验收：能力矩阵可准确解释已有离线成果，SP/SB/SD 不互相冒用。证据：`src/lib/amazon-ads/capabilities.ts`、`scripts/amazon-ads-capabilities.ts`、`tests/amazon-ads-capabilities.test.ts`。
- [ ] T02（FR02）形成 Campaign 正式报告版本决策记录，核对 V1 字段/身份与 V3 退出时间；记录证据、待确认项及选定路径。验收：不存在把 Profile ID 当 advertiserAccountId 的假设；未决项阻断相应真实 adapter。已有[暂缓正式接入决策](../../docs/amazon-ads-u1a-contract-and-data-semantics-2026-11-06.md)，但 V1 字段/身份与退出日期未重新核验，不能勾选合同验收完成。
- [x] T03（FR03/08）盘点 Task/Plan/Request 的 scope、授权身份、revision、合同摘要承载能力，提交最小字段/API diff。离线范围保护不依赖 T02 选定正式版本；正式创建入口仍待 T02。验收：重绑到同 revision 新授权也会停；旧 checkpoint/历史记录有兼容策略。证据：`report-scope.ts`、acquisition/publish 摘要复核及同 revision 换绑集成回归；最小 JSON diff 和兼容说明见 U1-A 文档。
- [x] T04（FR06/07，依赖 T02）定义空/缺行/覆盖、归因成熟、日期/时区与跨版本可比性；明确现有逐键最新选择的保留/替换条件。验收：给空报告、实体消失、迟到修订、不同时区四组前后示例，评审通过前不改查询语义。证据：[U1-A 决策记录](../../docs/amazon-ads-u1a-contract-and-data-semantics-2026-11-06.md)。

## 第二批：U1-B 原始证据与文件

- [x] T05（FR05）盘点 storage driver 流式能力，增加可选有界读取接口并限制 Ads 报告文件解析。验收：超大本地对象读取在超限首块停止、hash/size 不匹配不能发布，旧 `getBuffer` 调用方不变。S3/R2 stream 实现只接受异步可读 body；相关单测/隔离集成通过。证据：`src/lib/storage/bounded-buffer.ts`、local/S3 driver 与 Campaign Report 文件完整性测试。
- [x] T06（FR05/08，依赖 T05）保存成功请求/响应原始 body 字节的加密证据、失败固定错误码和 FileObject 引用。验收：正常页面/MCP 无原始正文或签名 URL；跨任务解密失败；文件/DB 非原子边界记录为剩余风险，不自动清理。失败原始 body 留待敏感级别/保留策略确认。证据：`report-acquisition.ts`、`amazon-ads-reports.integration.ts` 与 U1-A/U1-B 决策记录。
- [ ] T07（FR02/05，依赖 T02/T05）设计所选版本下载目标、重定向、地址解析、过期及多文件完整性规则。验收：使用 `.invalid` fixture 验证 SSRF/截断/压缩炸弹/缺文件；V3 单文件不伪造 V1 分片。

## 第三批：U1-C 队列运行

T07–T11评审使用[报告运行与恢复设计](report-runtime-design.md)；必须验证scheduler任务类型隔离、等待不占worker、reservation恢复、截止与RT01–RT10。任务总状态不替代Request阶段或操作结果。

T08结构兼容子项已有代码：结构scheduler/processor路由白名单、报告任务禁止结构重试、报告取消不污染entities freshness。见[任务路由隔离交付](../../docs/amazon-ads-task-routing-delivery-2026-11-06.md)。此子项不代表报告正式任务创建、调度或T08–T11整体完成。

T09/T10另补离线checkpoint损坏保护：调用前校验持久预算、阶段和reservation，不修复或清零异常记录；单测4/4、报表隔离集成32/32通过。见[checkpoint保护交付](../../docs/amazon-ads-checkpoint-delivery-2026-11-06.md)，不据此勾选整体任务。

T09/T10只读退避子项已有代码：poll/download 的429/5xx遵守Retry-After和持久预算指数退避，超总截止阻断，等待释放lease；create不重发。定向单测7/7、报表隔离集成36/36、类型与定向lint通过。见[只读退避交付](../../docs/amazon-ads-report-retry-delivery-2026-11-06.md)；正式合同、共享限流及完整故障矩阵仍未完成。

T09–T11新增隔离运行子项：数据库到期扫描、注入式投递、短lease单步执行、pause/resume/cancel、只读重试与过期恢复；两个实际BullMQ Worker实例验证采集至发布，报告集成31/31通过。见[报告运行层交付](../../docs/amazon-ads-report-runtime-delivery-2026-11-06.md)。未接入常规生产Worker或真实transport，尚缺优先级/跨Worker限流及完整kill/restart矩阵，以下整体复选状态保持未完成。

T11新增自动运行子项：显式fixture Worker服务、跨实例队列并发2、定时扫描锁、稳定jobId、容量背压及优雅关闭；新集成9/9通过，含真实子进程SIGKILL创建/下载恢复，报告回归36/36通过。见[Worker生命周期交付](../../docs/amazon-ads-report-worker-delivery-2026-11-06.md)。常规生产启动、正式transport、严格分布式准入和完整故障矩阵仍未完成，不勾选整体任务。

T09–T11续批修复扫描阻塞：暂停计划不占等待候选、缺失lease恢复、单行锁/事务失败隔离、入队前坏checkpoint/截止/未知create阻断，以及同Profile忙碌/已知冷却的持久延后。Worker专项14/14、报告回归36/36、定向lint与全库类型检查通过。见[Worker交付续批](../../docs/amazon-ads-report-worker-delivery-2026-11-06.md)。这不是完整正式API共享配额或全租户公平性实现，整体状态保持未完成。

- [ ] T08（FR03/04，依赖 T03）提交报告专用任务创建/调度设计及共享影响方案。验收：结构任务不隐式带报告请求，scope 不可被客户端扩大；审批/提交/启动分开。
- [ ] T09（FR03/04，依赖 T08）实现持久预算、nextPollAt、总截止、短 lease、续租/fence 和取消。验收：等待不占 worker；重启保留预算；取消后不再开始外部操作。
- [ ] T10（FR04/08，依赖 T09）实现合同限定的限流/失败/未知 create 恢复。验收：429/5xx/超时/重复消息不突破预算；未知创建不盲重试；重绑/撤权/角色变化停止。
- [ ] T11（FR04/05，依赖 T06/T07/T10）用真实 BullMQ + mock transport 串联 acquisition 至原子发布。验收：kill/restart、两个 worker、文件成功数据库失败、发布竞态均无重复或伪成功；仍关闭真实采集。

## 第四批：U1-D 可信查询与可见性

- [ ] T12（FR06/07，依赖 T02/T04/T11及D04–D06裁决）实现已评审的覆盖/时区/归因状态与版本选择；必要 schema 仅先生成迁移脚本并隔离验证。验收：零/null/空/未覆盖独立；新版本缺行按合同处理；历史版本可追溯。
- [ ] T13（US1/US2，依赖 T12）在既有 Campaign、同步详情和 MCP 展示同一质量/来源口径。验收：相同筛选下行、总量、totals、版本一致；不同时区不误合并；实时撤权无结果泄露。
- [ ] T14（FR01/04/07，依赖 T13）完成候选性能矩阵、文件内存与存储容量报告，更新 U1 交付清单。验收：记录硬件、种子、负载、P50/P95/P99；偏离候选门槛有证据与处理决定，不能只列测试数量。

## 第五批及以后：按成果开放

T17–T19参照[SP业务场景与页面职责](sp-business-delivery.md)；T20–T22参照[草稿/审批/执行生命周期](change-lifecycle.md)；T14/T16/T23使用[R1–R4验收关口与交接格式](acceptance-and-handoff.md)。这些文档是设计输入，不勾选实现或真实验收完成。

- [ ] T15（US3，依赖 T14）形成 U2 精确操作审批单：区分八类结构和一种报告、真实环境/配置/写入范围/预算/停止恢复。不执行。验收：所有目标和命令具体可审阅，无密钥进入文档。
- [ ] T16（US3，依赖 T15/T23试点最低子集 + 对应明确批准）受控真实只读试点，保存上游抽样、DB/UI/MCP 对账与消耗。验收：真实空结果不补 fixture；部分页不称完整；单独记录未覆盖域。
- [ ] T17（FR10，依赖相关域合同）U3 首域 Product Ad 结构及 Advertised Product 日报，保留 SKU/ASIN 关系与组织边界。验收：同一广告对象上下游可追溯，不把报表当对象同步。
- [ ] T18（FR09/10）Keyword/Targeting/Search Term 纵向切片及结构历史观察。验收：搜索词、触发对象、匹配类型、作用层级和建议时竞价有证据；历史缺失不能用当前值冒充。
- [ ] T19（FR10）Placement 与剩余 SP 业务页面；Portfolio/Budget 按场景合同补齐。验收：逐域 UI/MCP/质量同步交付，Demo 与真实状态明确。
- [ ] T20（US4，依赖 T12/T13/T18及场景结构证据）统一规则/AI 诊断与服务端草稿，复用现有规则/Bulk/审批。验收：策略可配置、冲突模拟、证据 digest、revision/过期、逐条接受拒绝；质量不足只给诊断。
- [ ] T21（US4，依赖 T20）校验 Bulk 导出和应用状态记录。验收：保留源 workbook、不导出未选项、不接受过期 before 值；“已导出”不等于“已应用”。
- [ ] T22（US5，依赖 T20/R3/T23最低子集 + 逐操作合同与批准；Bulk渠道另依赖T21）只选一种操作实现正式 transport、幂等、未知结果对账和回读。验收：审批对象/内容/revision 一致；部分成功逐项记录；逆向草稿重新审批。
- [ ] T23（US1/US5）先形成T16/T22前置的停止/恢复/容量/未知结果最低运维方案，再完善完整运维手册：容量、告警、保留期、密钥轮换、撤权后访问、孤立对象及恢复。验收：只先生成可审阅方案/脚本；无自动清理、配置修改或部署。
- [ ] T24（U6）以 SP 成果和业务收益评审 SB/SD、跨店铺与高级优化。验收：每产品单独合同和范围；未实现标待开发，官方不支持必须有证据。

任务依赖与交付分包按[PK01–PK09及依赖修正](plan.md)评审；正式合同补证按[CE01–CE10](first-batch-design.md)取证。不增加新的任务编号，也不改变已有交付复选状态。

## 本次规划验收

- [x] 明确已交付、待设计、待实现与真实验收边界。
- [x] 每批列依赖、交付物、验证和审批限制；候选性能门槛不冒充实测。
- [x] 保留现有生产与历史数据边界；未把后续任务勾选为已实现。
- [ ] 后续逐批完成实施、验证与交付记录后，才勾选对应 T 编号。

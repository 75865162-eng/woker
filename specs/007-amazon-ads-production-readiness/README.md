# Amazon Ads 升级规划索引

**最新阶段定义与待优化事项以[当前清单](current-optimization-backlog.md)为准：U2正式同步Worker、U3本地数据页面、U4 MCP/AI、U5真实只读试点与写执行。** 旧文件阶段编号保留历史，T01–T24保持不变；旧“U2真实试点”现映射为U5-A，不能仅凭编号判断范围。

日期：2026-11-06。用途：阅读入口与决策导航。任务状态只在[tasks.md](tasks.md)维护，完成依据指向专门交付记录；本索引不复制测试计数、不授予操作权限。

## 当前应看什么

| 目的 | 文档 |
| --- | --- |
| 按用户最新要求确定待优化事项/先后顺序 | [current-optimization-backlog.md](current-optimization-backlog.md) |
| 了解业务目标与范围 | [spec.md](spec.md)与[升级总计划](../../docs/amazon-ads-next-upgrade-plan-2026-11-06.md) |
| 查看下一批与依赖 | [plan.md](plan.md)中的PK01–PK09、[24项任务](tasks.md) |
| 核对已有离线成果 | [U1交付](../../docs/amazon-ads-u1-delivery-2026-11-06.md)、[U1-A/U1-B决策记录](../../docs/amazon-ads-u1a-contract-and-data-semantics-2026-11-06.md)及任务对应证据 |
| 处理版本/身份/最小模型 | [first-batch-design.md](first-batch-design.md)，CE01–CE10合同取证 |
| 决定缺行/null/时区/版本语义 | [data-contract.md](data-contract.md)，DC01–DC15 |
| 实现报告队列与恢复 | [report-runtime-design.md](report-runtime-design.md)，RT01–RT10 |
| 核对自动Worker、关闭与进程崩溃证据 | [Worker生命周期交付](../../docs/amazon-ads-report-worker-delivery-2026-11-06.md)，仅隔离服务，正式启动未启用 |
| 扩SP业务域与页面 | [sp-business-delivery.md](sp-business-delivery.md)，BS01–BS07 |
| 设计草稿/审批/API/Bulk对账 | [change-lifecycle.md](change-lifecycle.md)，CL01–CL08 |
| 验收、观测与交接 | [acceptance-and-handoff.md](acceptance-and-handoff.md)，R1–R4 |
| 准备真实试点 | [pilot-approval-template.md](pilot-approval-template.md)，空白且不可执行 |

## 尚待决定的关键事项

以下ID为决策索引，不替代T任务或ADR。状态是本轮规划判断，不表示已执行验收。

| 决策ID | 待定问题 | 阻断任务/成果 | 需要的证据 |
| --- | --- | --- | --- |
| D01 | 正式报告版本、账号身份/字段/区域 | T02、T07及正式adapter | 最新官方合同、身份映射证据；真实账号权限另验 |
| D02 | 正式任务创建时冻结范围与预算的模型 | T08–T10 | 现有scopeDigest复用方案、JSON/字段diff、旧任务兼容与CAS约束 |
| D03 | 下载host、DNS/重定向及多文件合同 | T07、T11 | 所选版本下载规则、安全fixture、part完整性 |
| D04 | 缺行/空报告与窗口替换 | T12、可信覆盖 | 官方范围保证与DC02–DC05裁决 |
| D05 | 乱序请求/迟到生成的版本裁决 | T12、回补 | 上游生成/修订时间能力或串行策略，DC06 |
| D06 | 历史时区、partial-null汇总及接口兼容 | T12/T13、跨Profile分析 | 历史证据来源、分组/响应版本方案、DC08–DC13 |
| D07 | 失败Raw保留、孤立对象记录与保留期 | T06剩余项、T23 | 敏感级别、容量、可恢复策略；清理操作另审 |
| D08 | 首个优化动作与权限/审批政策 | T20–T22 | 稳定对象ID、当前服务端权限盘点、逐操作合同与业务风险 |

## 建议推进顺序

1. 优先补D01官方合同与身份映射的可核实证据；未决继续正式阻断。
2. 结合已有T05/T06成果，补D07剩余设计；准备T08共享影响方案和RT案例。设计可先做，真实transport依赖合同。
3. D04–D06先形成DC案例裁决，再改SQL/数据模型/UI/MCP；不能用分析页面上线压力跳过语义决策。
4. R1通过后准备真实试点具体申请；R2通过才标目标账号可用；随后按SP场景和R3/R4推进。

用户继续完善规划只更新文档。本轮不扩大scope、不替任何真实审批签字；不重复实施其他聊天已完成的任务。正式合同补证与代码实现状态不同，已有parser/测试不证明账号验收。

## 文档维护规则

每次完成代码批次只更新对应T项及交付证据，必要时更新此索引的决策状态；历史文档保留原记录，在顶部或末尾标明后续进展。候选设计与实际实现不一致时写清差异，不让计划覆盖代码事实。

新增规划前先确认是否能补入已有文档。本轮补齐报告运行设计后，下一步优先关闭决策并实施已审阅任务，避免继续增加同义规划或把文档数量当交付进度。

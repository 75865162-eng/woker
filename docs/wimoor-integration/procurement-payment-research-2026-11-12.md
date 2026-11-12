# 采购付款：源码行为、ERP 实现与融合差异

日期：2026-11-12。仅为采购付款切片的源码审阅，不是完整采购流程或源系统运行验收。文件摘要见 [本次基线](evidence/research-baseline-2026-11-12.json)。源码根目录 `/Users/chenjieliang/Documents/wimoor`，以下源路径均相对该目录。

## 可追溯的源调用链

源 Controller：`wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/purchase/controller/PurchaseFormController.java`。
源 Service：同模块 `purchase/service/impl/PurchaseFormPaymentServiceImpl.java`。

1. Controller `:67` 定义 `/api/v1/purchase_form`；`:965-1127` 的事务 POST `/payment` 读取 PaymentSaveDTO，并创建货款、运费及其他费用付款记录，调用 `updatePayment`。DTO `status=1/2` 分别走结束付款/继续付款，`status=3` 将新记录 auditstatus 设为 2，其他新增付款分支设为 1。**DTO status 不等于 payment.auditstatus。**
2. Service `:268-317` 的 `updatePayment` 带事务注解，按付款 ID 更新或插入付款记录；每条调用 `saveRecord`，再汇总同采购明细已确认的货款。达到订单明细金额后置 paystatus=1；付款与入库标记均完成后置明细 auditstatus=3，并调用 `handleAvgPrice`。
3. Service `:129-164` 的 `saveRecord` 将新增付款或付款修改差额交给 FinAccount 处理；正数为 out，其他为 in 并取反。校验账户 shopid 与当前 companyid；isautopay 分支先累计 projectMap，不能将其描述为已即时写入正式总账。FinAccount 下游完整流水/余额事务仍待追踪。
4. Controller `:1146-1152` 的事务 GET `/cancelPayment` 调用 Service `:231-265`。源码拒绝超过 60 天的记录、拒绝 paystatus=1 的明细；将付款 auditstatus=0，调整货款汇总并调用资金撤销。该 GET 副作用和撤销政策不移植为目标 API 默认行为。
5. Service `:59-126` 的 `updatePaymentStatus` 有审核/资金记录逻辑；本次全源 Java 字面检索仅找到声明与实现，没有直接调用者。保留为调用可达性未确认的方法，不能据此宣布存在完整在线审核入口；反射/动态入口未证明不存在。

Controller 内存在捕获并打印异常后继续读取详情的分支；事务注解和源码路径不能证明所有失败都会正确回滚。未执行 Wimoor，不将该路径报告为运行可靠性已验证。

## 字段及关联证据

源 DDL：`init-config/mysql/数据库结构/db_erp/t_erp_purchase_form_payment.sql:20` 起；Entity：`.../purchase/pojo/entity/PurchaseFormPayment.java:18` 起；Mapper：`wimoor-erp/erp-boot/src/main/resources/mapper/purchase/PurchaseFormPaymentMapper.xml:16-40`。

| 源字段/关系 | 实现证据及语义 | ERP 当前对应与差异 |
| --- | --- | --- |
| id、formentryid | unsigned bigint；DDL 仅 id 主键及 formentryid 索引，**没有声明外键**；Mapper join 到采购明细，再到单头 | PurchasePayment 挂 PurchaseOrder，非 PurchaseOrderLine；不能把 formentryid 直接当 purchaseOrderId |
| payprice | decimal(18,2) 可空；Service 允许通过符号选择资金方向 | PurchasePayment.amount 为 Decimal(20,6)，退款单独 PurchasePaymentRefund；金额对外字符串，不能将负付款直塞正付款模型 |
| auditstatus | DDL 注释 1 已付款、2 请款中、0 驳回；撤销实现同样写 0 | 目标独立 Approval 的 PENDING/APPROVED/REJECTED/CONSUMED 等状态。源 0 无法单靠字段区分驳回与撤销，迁入须补上下文证据，否则保留未知 |
| projectid | 费用项目；Service 分货款/运费，Mapper join 到 t_erp_fin_project | 目标采购付款当前未见费用项目/逐明细分摊字段；目标会计映射也不等于采购费用项目。该切片部分实现 |
| acct、payment_method | 账户/付款方式；Mapper join 付款方式字典 | 目标 method 为字符串，正式会计账户由总账来源映射；不能直接复制源账户 ID 或付款方式数字 |
| opttime、operator、createdate、remark | 源操作时间/操作者/创建时间/备注，Mapper 映射与报表引用 | 目标 paidAt/createdAt/createdBy/notes 语义分别核对；操作时间不能默认为实际支付时间 |
| oldid | DDL char(36)；本切片未核实写入者和业务用途 | 不猜历史兼容或来源键，暂不映射 |
| currency | 本付款 DDL 无此列 | 目标从订单读取 currency。源币种须追账户/单据/配置，禁止在迁移时猜 CNY |

Entity 继承字段与 @TableField(exist=false) 显示字段不能全部当 SQL 列；Mapper 的关联是查询证据，不证明数据库外键或无重复 join。报表包含 Alibaba 结算 join，金额合计是否被放大须补测试，不能直接作为公司应付余额事实。

## 新增公式证据（源行为）

| ID | 公式/条件 | 源位置与特殊分支 | 融合决定 |
| --- | --- | --- | --- |
| F-010 | 已付货款=`Σ payprice`，仅同 formentryid、auditstatus=1 且满足 `type_cost.endsWith(projectid)`；合计≥entry.orderprice 时结束付款 | Service `:293-310`。这是字符串 endsWith 判断，不能默改称严格项目 ID 相等；该段不含运费/其他项目，无新增舍入 | 目标已有订单级额度检查，不等价于明细货款完成；先补明细分摊及费用项目语义，不能原样套用 |
| F-011 | 新记录资金变动=payprice；修改资金变动=new.payprice−old.payprice；正数 out，否则 in 且金额取反 | Service `:129-164`；零差额也走 in 分支，未在该方法阻断；源金额有 null 时无统一缺数兜底 | 目标保留不可变付款/独立退款/总账草稿，不复制编辑历史付款产生资金差额的行为 |
| F-012 | 报表待付=`entry.orderprice−entry.totalpay` | Mapper `:24`。没有 COALESCE 包住两操作数；NULL 仍为 NULL，未截断负值；结果会在多条付款行重复展示 | 不能按报表行直接求和当总应付，也不能把未知补零；目标独立按订单或明细计算并说明口径 |

既有 [F-002 加权成本](formula-evidence.md)仍为源行为证据；调用发生在该 Service 的入库/付款均完成分支，不意味着当前 ERP 已采用或应采用这个计价政策。以上公式未运行源测试，也未证明会计政策正确。

## ERP 当前能力（本次读代码，运行未复验）

| 能力 | 状态 | 当前证据与来源区别 |
| --- | --- | --- |
| 采购付款登记、独立复核、重试防重 | 已实现（代码） | [order-service.ts](../../src/lib/procurement/order-service.ts) submit/decide/confirm；按订单行金额总和约束“本次+已付+有效待批≤订单金额”，使用事务、订单锁和 revision。属于目标现有实现，不称 Wimoor 原样能力 |
| 独立退款单、余额占用与复核 | 已实现（代码） | [refund-service.ts](../../src/lib/procurement/refund-service.ts) 将本次退款+已退+有效待批约束在原付款内，确认时再次校验；源负付款不等于目标退款生命周期 |
| 付款/退款→总账草稿 | 已实现（代码） | [finance-source-query.ts](../../src/lib/procurement/finance-source-query.ts) 与 [source-service.ts](../../src/lib/finance/source-service.ts) 已接 PURCHASE_PAYMENT/PURCHASE_REFUND；来源复核、指纹和正式科目映射仍是条件，导入不代表已过账 |
| 采购明细费用项目、分摊及源账户流水对等 | 部分实现/待核实 | 目标有订单付款及独立总账映射；本切片未见源 projectid 对应的采购明细分摊。不是整个 ERP 财务缺失的结论 |
| 退款后的再次付款额度 | 需要进一步评审 | order-service 的已付聚合未扣 refunds；源与目标业务期望、退货/订单变更关系未核实。当前行为不能描述为按净支付额可重付，也不在本次擅自修改 |

Prisma 当前 PurchaseOrder/PurchasePayment/PurchasePaymentApproval/PurchasePaymentRefund/PurchasePaymentRefundApproval 已有作用域关系。仅证明当前工作树模型存在，不证明既有数据库已迁移。独立人员、有效期、摘要、不可变记录等是目标实现/扩展，是否来自历史移植需另查开发来源，不反向认领为 Wimoor 原生能力。

## 后续可执行任务

1. **R02-P1，补齐源付款审核与账户路径**：追 paymentApply、autopay、批量导入、FinAccount、PurchaseFinanceForm 等真实调用链，补金额符号、事务、异常和权限。交付每个入口的状态/副作用矩阵；未知动态入口保持未知。
2. **R02-P2，完成采购费用字段映射**：关联采购头/行、货款/运费/其他费用、收货与退货；确认源币种、项目字典及 oldid。逐项决定复用、目标扩展、排除或待资料，禁止直接导源表。
3. **R02-P3，目标差异评审后实施**：先明确费用按单还是按行、退款是否恢复付款额度及修改订单后的守恒合同。交付可审阅文件清单、模型/API影响、回退与隔离用例，再按仓库边界确认实施；不新建平行采购/财务事实源。
4. **验收向量**：部分/足额/超额付款、待批额度、不同费用项目、零/负/NULL、两次确认、源明细与目标单头粒度、退款并发、撤销/拒绝同码、跨工作区和多币种。它们是待运行验收要求，不是已通过结果。

本次仅读取源码、生成摘要和文档；没有运行数据库、Amazon、财务过账、历史数据迁入或生产操作。

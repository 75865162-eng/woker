# Wimoor 公式源码证据（首批）

状态：部分完成；只列已回到方法实现确认的公式，保留计算对象、来源、精度和特殊分支。该文件不构成完整公式穷尽、现行 Amazon 费率或公司财务政策。Wimoor 路径和扫描时工作树 SHA-256 见 [files.json](evidence/files.json)。

2026-11-12 增量：[采购付款 F-010～F-012](procurement-payment-research-2026-11-12.md#新增公式证据源行为)，含已付货款条件聚合、付款修改资金差额、报表待付金额；记录了源 endsWith 判断、零/NULL 分支及目标单据粒度差异。它们是源码审阅结果，未执行源运行验证，未改写原工作簿或宣称公式已穷尽。

| ID | 领域/公式 | 源码证据 | 已确认的条件、单位与精度 | 融合决定 |
| --- | --- | --- | --- | --- |
| F-001 | 体积重计费：`dimensionalWeight = volume(cm^3) / constantd`；运费=`max(actualWeight(kg), dimensionalWeight) * constantw`，再转站点币种 | `wimoor-amazon/amazon-boot/src/main/java/com/wimoor/amazon/profit/service/impl/ProfitServiceImpl.java:885-902` | weight 模式另按 `kg * constantw`；volume 模式按 `(volume / constantd) * constantw`；dim_weight 8 位 HALF_UP，volume 4 位 HALF_UP；费率/币种由国家利润配置和本地汇率服务提供 | 已在 `src/lib/logistics/freight-estimate.ts` 接入本地估算，换算系数/运价由用户输入；不接费率表、汇率、付款或财务凭证。费用分摊仍待 P1 评估 |
| F-002 | 采购商品加权价：`(previousAverage * beforeQty + currentPurchaseTotal) / currentInventoryQty` | `wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/purchase/service/impl/PurchaseFormPaymentServiceImpl.java:383-415` | 首次价格=`totalprice / amount` (2 位 HALF_UP)；后续均价按 `totalinv` 作分母；其他费用分开存 `priceShipWavg`，4 位 HALF_UP。`amount_before=totalinv-amount`。调用使用 fulfillable 快照 | 仅作为源行为证据。算法对“采购前库存”与分母的注释/变量语义需要实测复核；新 ERP 应由收货成本事件和现有库存数量明确推导，禁止直接照搬 |
| F-003 | FBA 月仓储估算：`monthlyStorageFee * (volume(in^3)/1728) * configuredMonths` | `wimoor-amazon/amazon-boot/src/main/java/com/wimoor/amazon/profit/service/impl/ProfitServiceImpl.java:290-297` | 立方英寸转立方英尺；volume 转换除数结果 4 位 HALF_UP；结尾乘费率/月数。注释称按月比例收费，季节、库龄或 Amazon 实际账单调整未在此方法体现 | 已在物流工作台接入本地参考估算；月费由用户输入，体积换算保留 4 位，金额保留精确乘积小数，不作实际费用或总账凭证 |
| F-004 | 出库计费重：`ceil((itemWeight + packageWeight) * 1000, 2 decimals in grams) / 1000` | 同文件 `:305-318` | 注释称单位 Kg、先换算为 g、至少按 1g 进位；随后除回 kg 保留 3 位并 CEILING | 单位转换与两次舍入需建立测试向量；与当前 Seller/Marketplace 的费率表对齐后才可实现 |
| F-005 | 成本结构与税费：关税=`declaredValue * taxRate`；进口 GST=`(1+taxRate) * declaredValue * gstrRate` | 同文件 `:851-868` | 税率先从百分比除以 100，4 位 HALF_UP；IN 可用申报价值及币种转换，否则申报价值=`purchase+shipment`；税额 4 位 HALF_UP | 作为利润估算规则证据，纳税主体、税基、市场及申报政策必须按公司/站点重新确认，不能成为会计自动入账默认值 |
| F-006 | 目标售价（参考毛利率） | 同文件 `:98-165`, `:172-207` | margin 候选 `[0, .10, .15, .20, .25, .30, .50]`；先假设佣金=`price*referralRate`，最低佣金触发后重算；售价 2 位 HALF_UP；UK、IN 有专门分支，存在阶段费率/closing fee 二次计算 | 保存分支方程和费率来源后再写逐站点测试；本方法注释方程和代码表达要逐项复核，不能只移植注释公式 |
| F-007 | 参考利润显示：`estimatedProfit = sellingPrice * margin` | 同文件 `:158-162` | 这里返回的是按候选 margin 推导的显示利润，不等同过账后净利润；结果格式化为字符串 | 不用于财务报表或实际毛利事实；新 ERP 使用明确的利润口径/来源和精度 |
| F-008 | Amazon 直接收费（不含佣金）聚合 | 同文件 `:226-230` | FBA、closing、VC、storage、in-place、prep、manual-processing、label service 相加 | 作为旧估算组成项；费项必须按站点/时期及真实交易数据映射，未知项保留 null |
| F-009 | 汇率损耗及百分比费率建模 | 同文件 `:811-849` | 百分比配置转小数用 4 位 HALF_UP；`rateFee = sellerRate + costRate`；汇率损耗注释定义为售价扣 Amazon 直接费与佣金后的剩余金额乘 lostrate | 复核 `calculateSellingPrice` 中所用费用的基数、国家差异、配置单位；不应把估算费率合并到财务实际金额 |

## 公式目录缺口

1. 当前 `wimoor-business-rules.xlsx` 的 8 条 VERIFIED 规则是 WMS 状态/库存规则，不是全部公式。上述 9 条为补充的首批公式人工核验，不应反向宣称其他领域已穷尽。
2. 采购补货计划 SQL/服务、月度库存周转/库龄、退款/付款和头程费用分摊仍要沿 controller/service/mapper 调用链逐项提取；仅找到字段或视图不能确定数学含义。
3. 财务模块结账、余额方向、损益结转服务继续单独核对借贷规则、舍入、期间锁定及冲销。数学计算代码不证明业务会计政策正确。
4. 广告指标先识别 Amazon 原始指标与 Wimoor 自算指标，记录分子/分母、归因窗口和零值/null 行为；本首批公式没有覆盖 Ads 算法。
5. 后续每条公式需补：稳定 ID、输入字段及事实源、单位/币种、分支条件、NULL/缺数据处理、舍入位置/模式、源码调用链、源测试、当前 ERP 对照及验收向量。源码注释单独登记为说明，不作为运行实现证据。

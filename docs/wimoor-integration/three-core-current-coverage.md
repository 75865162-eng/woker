# 三域候选表与当前代码覆盖

候选来自原证据索引；所有行 fullSourceParityVerified=false。TARGET_REUSE 仅表示已有目标端服务承担该职责，不证明源字段/规则逐项对等。源 DDL 哈希及列清单在同名 JSON；并行 DDL 副本未自动裁决。

| 候选源表 | 当前状态 | 目标模型 | 边界 |
| --- | --- | --- | --- |
| `t_erp_changewh_form` | TARGET_REUSE | WmsCommand, WmsMovement | SKU 转换与追加反向命令，保留原商品主档。 |
| `t_erp_changewh_form_entry` | TARGET_REUSE | WmsCommand, WmsMovement | SKU 转换与追加反向命令，保留原商品主档。 |
| `t_erp_dispatch_form` | TARGET_REUSE | WmsTransferOrder, WmsTransferOrderLine, WmsMovement | 部分发出/签收、在途、审批和数量守恒。 |
| `t_erp_dispatch_form_entry` | TARGET_REUSE | WmsTransferOrder, WmsTransferOrderLine, WmsMovement | 部分发出/签收、在途、审批和数量守恒。 |
| `t_erp_dispatch_form_record` | TARGET_REUSE | WmsTransferOrder, WmsTransferOrderLine, WmsMovement | 部分发出/签收、在途、审批和数量守恒。 |
| `t_erp_dispatch_oversea_box` | PARTIAL | WmsOverseasManifest, WmsOverseasBox, WmsTransferOrder, WmsOverseasCharge | 海外装箱/运输/在途及预估/最终费差额、箱到行精确分摊/独审/总账草稿交接；所有第三方物流执行未验收。 |
| `t_erp_dispatch_oversea_case` | PARTIAL | WmsOverseasManifest, WmsOverseasBox, WmsTransferOrder, WmsOverseasCharge | 海外装箱/运输/在途及预估/最终费差额、箱到行精确分摊/独审/总账草稿交接；所有第三方物流执行未验收。 |
| `t_erp_dispatch_oversea_form` | PARTIAL | WmsOverseasManifest, WmsOverseasBox, WmsTransferOrder, WmsOverseasCharge | 海外装箱/运输/在途及预估/最终费差额、箱到行精确分摊/独审/总账草稿交接；所有第三方物流执行未验收。 |
| `t_erp_dispatch_oversea_form_entry` | PARTIAL | WmsOverseasManifest, WmsOverseasBox, WmsTransferOrder, WmsOverseasCharge | 海外装箱/运输/在途及预估/最终费差额、箱到行精确分摊/独审/总账草稿交接；所有第三方物流执行未验收。 |
| `t_erp_dispatch_oversea_trans` | PARTIAL | WmsOverseasManifest, WmsOverseasBox, WmsTransferOrder, WmsOverseasCharge | 海外装箱/运输/在途及预估/最终费差额、箱到行精确分摊/独审/总账草稿交接；所有第三方物流执行未验收。 |
| `t_erp_inventory` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_inventory_his` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_inventory_his_day` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_inventory_month_summary` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_inventory_record` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_inwh_form` | TARGET_REUSE | WmsReceipt, WmsReceiptLine, WmsLot | 采购/收货、质检、上架及拒收退回，沿目标端事务。 |
| `t_erp_inwh_form_entry` | TARGET_REUSE | WmsReceipt, WmsReceiptLine, WmsLot | 采购/收货、质检、上架及拒收退回，沿目标端事务。 |
| `t_erp_outwh_form` | TARGET_REUSE | WmsOutbound, WmsOutboundLine, WmsReservation | 多行出库需求与批次分配、预占/拣货/出库、耗材。 |
| `t_erp_outwh_form_consumable` | TARGET_REUSE | WmsOutbound, WmsOutboundLine, WmsReservation | 多行出库需求与批次分配、预占/拣货/出库、耗材。 |
| `t_erp_outwh_form_entry` | TARGET_REUSE | WmsOutbound, WmsOutboundLine, WmsReservation | 多行出库需求与批次分配、预占/拣货/出库、耗材。 |
| `t_erp_stocktaking` | PARTIAL | WmsStocktake, WmsStocktakeLine, WmsStocktakeLocation | 库位批次盘点与差异过账、FULL/SAMPLE/有依据 ACTIVITY、盲盘及受控打印；所有状态的盲盘打印隐藏基准/差异。源全部样式未逐项对等。 |
| `t_erp_stocktaking_item` | PARTIAL | WmsStocktake, WmsStocktakeLine, WmsStocktakeLocation | 库位批次盘点与差异过账、FULL/SAMPLE/有依据 ACTIVITY、盲盘及受控打印；所有状态的盲盘打印隐藏基准/差异。源全部样式未逐项对等。 |
| `t_erp_stocktaking_item_shelf` | PARTIAL | WmsStocktake, WmsStocktakeLine, WmsStocktakeLocation | 库位批次盘点与差异过账、FULL/SAMPLE/有依据 ACTIVITY、盲盘及受控打印；所有状态的盲盘打印隐藏基准/差异。源全部样式未逐项对等。 |
| `t_erp_stocktaking_shelf` | PARTIAL | WmsStocktake, WmsStocktakeLine, WmsStocktakeLocation | 库位批次盘点与差异过账、FULL/SAMPLE/有依据 ACTIVITY、盲盘及受控打印；所有状态的盲盘打印隐藏基准/差异。源全部样式未逐项对等。 |
| `t_erp_stocktaking_warehouse` | PARTIAL | WmsStocktake, WmsStocktakeLine, WmsStocktakeLocation | 库位批次盘点与差异过账、FULL/SAMPLE/有依据 ACTIVITY、盲盘及受控打印；所有状态的盲盘打印隐藏基准/差异。源全部样式未逐项对等。 |
| `t_erp_warehouse` | TARGET_REUSE | WmsWarehouse, WmsArea | 复用现有仓库事实源。 |
| `t_erp_warehouse_address` | TARGET_REUSE | WmsWarehouseAddress | 地址和运输单据地址快照。 |
| `t_erp_warehouse_shelf` | TARGET_REUSE | WmsLocation | 库位、树、冻结和容量。 |
| `t_erp_warehouse_shelf_inventory` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_warehouse_shelf_inventory_opt_record` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `t_erp_warehouse_type` | TARGET_REUSE | WmsWarehouseType | 自定义仓库类型。 |
| `t_erp_whse_unsalable_rpt` | PARTIAL | WmsMovement, WmsAgingSnapshot, WmsAgingSchedule, WmsInventoryRiskAssessment | 库龄证据/当日快照/默认关闭调度、显式销量窗口与 NRV 跌价评估、独立复核及总账来源；缺数保持 NEEDS_DATA，不冒充实际销量自动采集。 |
| `t_amz_inbound_fba_cycle` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_amz_ship_fulfillment_center` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_address` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_addressto` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundbox` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundcase` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inbounditem` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundplan` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundshipment` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundshipment_record` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundshipment_traceupload` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundtrans` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_inboundtrans_his` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_shipcycle` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_warehouse_shelf_inventory_opt_record` | PARTIAL | WmsStockBalance, WmsMovement, WmsCommand | 数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。 |
| `fin_accounting_periods` | TARGET_REUSE | FinancePeriod, FinanceCloseReview | 期间与独立关账复核；无自动全业务来源完整性证明。 |
| `fin_accounting_subject_auxiliary_setting` | TARGET_REUSE | FinanceAuxiliaryType, FinanceAuxiliaryItem, FinanceSubjectAuxiliary, FinanceVoucherAuxiliary, FinanceVoucherType, FinanceVoucherProfile | 目标端定义辅助类型/项目/科目必填规则和凭证类别，草稿版本编辑、独立审核及过账校验、冲销继承；历史定义追加保留，不代表源全部状态管理已对等。 |
| `fin_accounting_subjects` | TARGET_REUSE | FinanceSubject, FinanceSubjectCategory | 多级科目、借贷方向、1–3级类别树、固定类别保护、revision编辑/停用/未引用删除；已审核凭证保留原证据。 |
| `fin_auxiliary_items` | TARGET_REUSE | FinanceAuxiliaryType, FinanceAuxiliaryItem, FinanceSubjectAuxiliary, FinanceVoucherAuxiliary, FinanceVoucherType, FinanceVoucherProfile | 目标端定义辅助类型/项目/科目必填规则和凭证类别，草稿版本编辑、独立审核及过账校验、冲销继承；历史定义追加保留，不代表源全部状态管理已对等。 |
| `fin_auxiliary_types` | TARGET_REUSE | FinanceAuxiliaryType, FinanceAuxiliaryItem, FinanceSubjectAuxiliary, FinanceVoucherAuxiliary, FinanceVoucherType, FinanceVoucherProfile | 目标端定义辅助类型/项目/科目必填规则和凭证类别，草稿版本编辑、独立审核及过账校验、冲销继承；历史定义追加保留，不代表源全部状态管理已对等。 |
| `fin_closing_template` | PARTIAL | FinanceReportTemplate, FinanceCloseReview | 目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。 |
| `fin_closing_template_amazon` | PARTIAL | FinanceReportTemplate, FinanceCloseReview | 目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。 |
| `fin_closing_template_feishu` | PARTIAL | FinanceReportTemplate, FinanceCloseReview | 目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。 |
| `fin_closing_template_item` | PARTIAL | FinanceReportTemplate, FinanceCloseReview | 目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。 |
| `fin_closing_template_profit_loss` | PARTIAL | FinanceReportTemplate, FinanceCloseReview | 目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。 |
| `fin_closing_template_vouchers` | PARTIAL | FinanceReportTemplate, FinanceCloseReview | 目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。 |
| `fin_currency` | PARTIAL | FinanceBook, FinanceCurrency, FinanceExchangeRate, FinanceFxRevaluation | 目标端币种/独立汇率、货币项目重估证据、缺数阻断/取消、独立审核、差额来源交接与关账门禁；科目及完整性依目标端证据。 |
| `fin_detail_ledger` | TARGET_REUSE | FinanceVoucher, FinanceVoucherLine, FinanceOpeningBalance | 从已过账总账派生，不另建可变余额事实源。 |
| `fin_general_ledger` | TARGET_REUSE | FinanceVoucher, FinanceVoucherLine, FinanceOpeningBalance | 从已过账总账派生，不另建可变余额事实源。 |
| `fin_report_items` | PARTIAL | FinanceReportTemplate | 显式科目/符号/期间映射及受限精确四则公式/引用；全部源公式及模板样式未逐项对等。 |
| `fin_report_mapping_rules` | PARTIAL | FinanceReportTemplate | 显式科目/符号/期间映射及受限精确四则公式/引用；全部源公式及模板样式未逐项对等。 |
| `fin_report_templates` | PARTIAL | FinanceReportTemplate | 显式科目/符号/期间映射及受限精确四则公式/引用；全部源公式及模板样式未逐项对等。 |
| `fin_subject_type` | TARGET_REUSE | FinanceSubject, FinanceSubjectCategory | 多级科目、借贷方向、1–3级类别树、固定类别保护、revision编辑/停用/未引用删除；已审核凭证保留原证据。 |
| `fin_voucher_entries` | TARGET_REUSE | FinanceVoucher, FinanceVoucherLine, AuditLog | 独立审核、过账、追加冲销、幂等、审计。 |
| `fin_voucher_entries_auxiliary` | TARGET_REUSE | FinanceAuxiliaryType, FinanceAuxiliaryItem, FinanceSubjectAuxiliary, FinanceVoucherAuxiliary, FinanceVoucherType, FinanceVoucherProfile | 目标端定义辅助类型/项目/科目必填规则和凭证类别，草稿版本编辑、独立审核及过账校验、冲销继承；历史定义追加保留，不代表源全部状态管理已对等。 |
| `fin_voucher_inventory_detail` | TARGET_REUSE | WmsCostEntry, WmsCostAdjustment, FinanceVoucher | 库存成本来源带商品/批次/仓/数量/单价；正式转入时保存不可变来源与非零分录行号的辅助证据，冲销沿原证据查询。 |
| `fin_voucher_modify_log` | TARGET_REUSE | FinanceVoucher, FinanceVoucherLine, AuditLog | 独立审核、过账、追加冲销、幂等、审计。 |
| `fin_voucher_type` | TARGET_REUSE | FinanceAuxiliaryType, FinanceAuxiliaryItem, FinanceSubjectAuxiliary, FinanceVoucherAuxiliary, FinanceVoucherType, FinanceVoucherProfile | 目标端定义辅助类型/项目/科目必填规则和凭证类别，草稿版本编辑、独立审核及过账校验、冲销继承；历史定义追加保留，不代表源全部状态管理已对等。 |
| `fin_voucher_upload` | PARTIAL | FinanceVoucherImport, FinanceVoucher, FinanceVoucherLine | 目标结构化行的来源暂存/校验/错误证据与整批草稿交接；新增严格文本 XLSX 模板（禁公式/有界解压），不猜测源全部 Excel 样式或自动汇兑；全部独立审核过账。 |
| `fin_vouchers` | TARGET_REUSE | FinanceVoucher, FinanceVoucherLine, AuditLog | 独立审核、过账、追加冲销、幂等、审计。 |
| `fin_vourches_file` | TARGET_REUSE | FinanceVoucherAttachment, FileObject | 复用存储适配器和 FileObject，受控草稿上传、原件摘要/下载审计、追加不可变证据和冲销继承；无批量历史附件导入。 |
| `t_erp_fin_account` | TARGET_REUSE | FinanceBook, FinanceExpense, FinanceOpenItem, FinanceSettlement, FinanceBankAccount, FinanceBankStatement, FinanceBankMatch | 复用总账/费用/往来、账户状态/默认/支付方式、项目辅助类型与项目受控生命周期；按已过账银行科目和项目维度派生月收付/余额，未知归类null；银行连接未验收。 |
| `t_erp_fin_journalaccount` | TARGET_REUSE | FinanceBook, FinanceExpense, FinanceOpenItem, FinanceSettlement, FinanceBankAccount, FinanceBankStatement, FinanceBankMatch | 复用总账/费用/往来、账户状态/默认/支付方式、项目辅助类型与项目受控生命周期；按已过账银行科目和项目维度派生月收付/余额，未知归类null；银行连接未验收。 |
| `t_erp_fin_journaldaily` | TARGET_REUSE | FinanceBook, FinanceExpense, FinanceOpenItem, FinanceSettlement, FinanceBankAccount, FinanceBankStatement, FinanceBankMatch | 复用总账/费用/往来、账户状态/默认/支付方式、项目辅助类型与项目受控生命周期；按已过账银行科目和项目维度派生月收付/余额，未知归类null；银行连接未验收。 |
| `t_erp_fin_project` | TARGET_REUSE | FinanceBook, FinanceExpense, FinanceOpenItem, FinanceSettlement, FinanceBankAccount, FinanceBankStatement, FinanceBankMatch | 复用总账/费用/往来、账户状态/默认/支付方式、项目辅助类型与项目受控生命周期；按已过账银行科目和项目维度派生月收付/余额，未知归类null；银行连接未验收。 |
| `t_erp_fin_type_journalmonthly` | TARGET_REUSE | FinanceBook, FinanceExpense, FinanceOpenItem, FinanceSettlement, FinanceBankAccount, FinanceBankStatement, FinanceBankMatch | 复用总账/费用/往来、账户状态/默认/支付方式、项目辅助类型与项目受控生命周期；按已过账银行科目和项目维度派生月收付/余额，未知归类null；银行连接未验收。 |
| `t_product_customs_setting` | PARTIAL | FbaLocalCustomsDeclaration, FbaCustomsProfile, FbaCustomsTemplate, FbaCustomsExport | 商品级报关版本、独立激活、逐单快照及目标国家/货代 XML 模板导出；不宣称官方 XSD 或法定申报已验证。 |
| `t_erp_ship_v2_inboundbox` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundcase` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_destination_address` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inbounditem` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundoperation` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundplan` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundplan_delivery_options` | PARTIAL | FbaWorkflowOptionSnapshot, FbaWorkflowOptionSelection, FbaRemoteAction, FbaRemotePlanBinding, FbaRemoteExecutionPolicy, FbaRemoteReadSnapshot | 源 SDK 45 操作/50 请求 DTO 的协议适配、默认关闭的持久化执行/异步回读、自动方案证据及独立选择；绑定货件关联和确认阶段，未知结果不重发。仅隔离验证，源 SDK 不证明最新官方完整对等。 |
| `t_erp_ship_v2_inboundplan_packing_options_group_item` | PARTIAL | FbaWorkflowOptionSnapshot, FbaWorkflowOptionSelection, FbaRemoteAction, FbaRemotePlanBinding, FbaRemoteExecutionPolicy, FbaRemoteReadSnapshot | 源 SDK 45 操作/50 请求 DTO 的协议适配、默认关闭的持久化执行/异步回读、自动方案证据及独立选择；绑定货件关联和确认阶段，未知结果不重发。仅隔离验证，源 SDK 不证明最新官方完整对等。 |
| `t_erp_ship_v2_inboundplan_packing_options` | PARTIAL | FbaWorkflowOptionSnapshot, FbaWorkflowOptionSelection, FbaRemoteAction, FbaRemotePlanBinding, FbaRemoteExecutionPolicy, FbaRemoteReadSnapshot | 源 SDK 45 操作/50 请求 DTO 的协议适配、默认关闭的持久化执行/异步回读、自动方案证据及独立选择；绑定货件关联和确认阶段，未知结果不重发。仅隔离验证，源 SDK 不证明最新官方完整对等。 |
| `t_erp_ship_v2_inboundplan_placement_options` | PARTIAL | FbaWorkflowOptionSnapshot, FbaWorkflowOptionSelection, FbaRemoteAction, FbaRemotePlanBinding, FbaRemoteExecutionPolicy, FbaRemoteReadSnapshot | 源 SDK 45 操作/50 请求 DTO 的协议适配、默认关闭的持久化执行/异步回读、自动方案证据及独立选择；绑定货件关联和确认阶段，未知结果不重发。仅隔离验证，源 SDK 不证明最新官方完整对等。 |
| `t_erp_ship_v2_inboundplan_transportation_options` | PARTIAL | FbaWorkflowOptionSnapshot, FbaWorkflowOptionSelection, FbaRemoteAction, FbaRemotePlanBinding, FbaRemoteExecutionPolicy, FbaRemoteReadSnapshot | 源 SDK 45 操作/50 请求 DTO 的协议适配、默认关闭的持久化执行/异步回读、自动方案证据及独立选择；绑定货件关联和确认阶段，未知结果不重发。仅隔离验证，源 SDK 不证明最新官方完整对等。 |
| `t_erp_ship_v2_inboundshipment` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundshipment_box` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundshipment_boxitem` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundshipment_custom` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundshipment_customs` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundshipment_delivery` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inboundshipment_item` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_v2_inbound_record` | PARTIAL | FbaLocalPlan, FbaLocalShipment, FbaExternalOperationRecord, FbaRemoteAction, FbaRemoteReadSnapshot | 计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。 |
| `t_erp_ship_shipment_template_file` | PARTIAL | FbaLocalShipmentDocument | 本地货件资料记录与撤销证据；源所有文件模板、Amazon 标签下载和套打未逐项移植。 |

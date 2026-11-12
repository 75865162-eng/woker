"""Read-only source/target evidence inventory. No SQL execution, migration or network."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('/Users/chenjieliang/Documents/wimoor')
MEMBERSHIP = ROOT / 'docs/wimoor-integration/evidence/module_membership.json'
SCHEMA = (ROOT / 'prisma/schema.prisma').read_text()
MODELS = dict(re.findall(r'model (\w+) \{(.*?)\n\}', SCHEMA, re.S))


def mapping(table):
    if table == 't_product_customs_setting':
        return ['FbaLocalCustomsDeclaration', 'FbaCustomsProfile', 'FbaCustomsTemplate', 'FbaCustomsExport'], ['src/lib/fba-local/customs-service.ts', 'src/lib/fba-local/customs-profile-service.ts', 'src/lib/fba-local/customs-template-service.ts'], 'PARTIAL', '商品级报关版本、独立激活、逐单快照及目标国家/货代 XML 模板导出；不宣称官方 XSD 或法定申报已验证。'
    if table == 't_erp_ship_shipment_template_file':
        return ['FbaLocalShipmentDocument'], ['src/lib/fba-local/shipment-document-service.ts'], 'PARTIAL', '本地货件资料记录与撤销证据；源所有文件模板、Amazon 标签下载和套打未逐项移植。'
    if table.startswith('t_erp_ship_v2_inboundplan_'):
        return ['FbaWorkflowOptionSnapshot', 'FbaWorkflowOptionSelection', 'FbaRemoteAction', 'FbaRemotePlanBinding', 'FbaRemoteExecutionPolicy', 'FbaRemoteReadSnapshot'], ['src/lib/fba-local/workflow-options.ts', 'src/lib/fba-local/inbound-write-contract.ts', 'src/lib/fba-local/remote-action-service.ts', 'src/lib/fba-local/remote-action-executor.ts'], 'PARTIAL', '源 SDK 45 操作/50 请求 DTO 的协议适配、默认关闭的持久化执行/异步回读、自动方案证据及独立选择；绑定货件关联和确认阶段，未知结果不重发。仅隔离验证，源 SDK 不证明最新官方完整对等。'
    if table.startswith('fin_'):
        if table == 'fin_voucher_upload':
            return ['FinanceVoucherImport', 'FinanceVoucher', 'FinanceVoucherLine'], ['src/lib/finance/voucher-import-service.ts', 'src/lib/finance/voucher-import-rules.ts', 'src/lib/finance/voucher-workbook.ts'], 'PARTIAL', '目标结构化行的来源暂存/校验/错误证据与整批草稿交接；新增严格文本 XLSX 模板（禁公式/有界解压），不猜测源全部 Excel 样式或自动汇兑；全部独立审核过账。'
        if table == 'fin_vourches_file':
            return ['FinanceVoucherAttachment', 'FileObject'], ['src/lib/finance/attachment-service.ts', 'src/lib/finance/attachment-rules.ts'], 'TARGET_REUSE', '复用存储适配器和 FileObject，受控草稿上传、原件摘要/下载审计、追加不可变证据和冲销继承；无批量历史附件导入。'
        if table in ['fin_auxiliary_types', 'fin_auxiliary_items', 'fin_accounting_subject_auxiliary_setting', 'fin_voucher_entries_auxiliary', 'fin_voucher_type']:
            return ['FinanceAuxiliaryType', 'FinanceAuxiliaryItem', 'FinanceSubjectAuxiliary', 'FinanceVoucherAuxiliary', 'FinanceVoucherType', 'FinanceVoucherProfile'], ['src/lib/finance/auxiliary-service.ts', 'src/lib/finance/auxiliary-rules.ts'], 'TARGET_REUSE', '目标端定义辅助类型/项目/科目必填规则和凭证类别，草稿版本编辑、独立审核及过账校验、冲销继承；历史定义追加保留，不代表源全部状态管理已对等。'
        if table in ['fin_accounting_periods']:
            return ['FinancePeriod', 'FinanceCloseReview'], ['src/lib/finance/ledger-service.ts', 'src/lib/finance/close-service.ts'], 'TARGET_REUSE', '期间与独立关账复核；无自动全业务来源完整性证明。'
        if table in ['fin_accounting_subjects', 'fin_subject_type']:
            return ['FinanceSubject', 'FinanceSubjectCategory'], ['src/lib/finance/ledger-service.ts', 'src/lib/finance/catalog-service.ts'], 'TARGET_REUSE', '多级科目、借贷方向、1–3级类别树、固定类别保护、revision编辑/停用/未引用删除；已审核凭证保留原证据。'
        if table in ['fin_general_ledger', 'fin_detail_ledger']:
            return ['FinanceVoucher', 'FinanceVoucherLine', 'FinanceOpeningBalance'], ['src/lib/finance/ledger-service.ts', 'src/lib/finance/report-service.ts'], 'TARGET_REUSE', '从已过账总账派生，不另建可变余额事实源。'
        if table in ['fin_report_items', 'fin_report_mapping_rules', 'fin_report_templates']:
            return ['FinanceReportTemplate'], ['src/lib/finance/report-service.ts', 'src/lib/finance/report-rules.ts', 'src/lib/finance/report-formula.ts'], 'PARTIAL', '显式科目/符号/期间映射及受限精确四则公式/引用；全部源公式及模板样式未逐项对等。'
        if table.startswith('fin_closing_template'):
            return ['FinanceReportTemplate', 'FinanceCloseReview'], ['src/lib/finance/report-service.ts', 'src/lib/finance/close-service.ts', 'src/lib/finance/voucher-template-service.ts'], 'PARTIAL', '目标端损益结转及版本化字段/科目/方向/受限表达式凭证映射、来源键与独立审核草稿；Amazon/Ads沿统一已发布来源；不包含真实飞书连接。'
        if table in ['fin_vouchers', 'fin_voucher_entries', 'fin_voucher_modify_log']:
            return ['FinanceVoucher', 'FinanceVoucherLine', 'AuditLog'], ['src/lib/finance/ledger-service.ts'], 'TARGET_REUSE', '独立审核、过账、追加冲销、幂等、审计。'
        if table == 'fin_voucher_inventory_detail':
            return ['WmsCostEntry', 'WmsCostAdjustment', 'FinanceVoucher'], ['src/lib/wms/finance-source-query.ts', 'src/lib/wms/cost-adjustment-service.ts', 'src/lib/finance/source-service.ts', 'src/lib/finance/structure-query.ts'], 'TARGET_REUSE', '库存成本来源带商品/批次/仓/数量/单价；正式转入时保存不可变来源与非零分录行号的辅助证据，冲销沿原证据查询。'
        if table == 'fin_currency':
            return ['FinanceBook', 'FinanceCurrency', 'FinanceExchangeRate', 'FinanceFxRevaluation'], ['src/lib/finance/fx-rules.ts', 'src/lib/finance/catalog-service.ts', 'src/lib/finance/fx-revaluation-service.ts'], 'PARTIAL', '目标端币种/独立汇率、货币项目重估证据、缺数阻断/取消、独立审核、差额来源交接与关账门禁；科目及完整性依目标端证据。'
        return [], [], 'UNIMPLEMENTED', '独立辅助核算、凭证类型/上传/附件生命周期无完整目标合同；不以 JSON 空字段宣称移植。'
    if table.startswith('t_erp_fin_'):
        return ['FinanceBook', 'FinanceExpense', 'FinanceOpenItem', 'FinanceSettlement', 'FinanceBankAccount', 'FinanceBankStatement', 'FinanceBankMatch'], ['src/lib/finance/expense-service.ts', 'src/lib/finance/open-item-service.ts', 'src/lib/finance/bank-service.ts', 'src/lib/finance/structure-query.ts', 'src/lib/finance/auxiliary-service.ts'], 'TARGET_REUSE', '复用总账/费用/往来、账户状态/默认/支付方式、项目辅助类型与项目受控生命周期；按已过账银行科目和项目维度派生月收付/余额，未知归类null；银行连接未验收。'
    if table in ['t_erp_changewh_form', 't_erp_changewh_form_entry']:
        return ['WmsCommand', 'WmsMovement'], ['src/lib/wms/sku-conversion-service.ts'], 'TARGET_REUSE', 'SKU 转换与追加反向命令，保留原商品主档。'
    if 'dispatch_oversea' in table:
        return ['WmsOverseasManifest', 'WmsOverseasBox', 'WmsTransferOrder', 'WmsOverseasCharge'], ['src/lib/wms/overseas-service.ts', 'src/lib/wms/transfer-order-service.ts', 'src/lib/wms/overseas-charge-service.ts'], 'PARTIAL', '海外装箱/运输/在途及预估/最终费差额、箱到行精确分摊/独审/总账草稿交接；所有第三方物流执行未验收。'
    if 'dispatch_form' in table:
        return ['WmsTransferOrder', 'WmsTransferOrderLine', 'WmsMovement'], ['src/lib/wms/transfer-order-service.ts'], 'TARGET_REUSE', '部分发出/签收、在途、审批和数量守恒。'
    if 'stocktaking' in table:
        return ['WmsStocktake', 'WmsStocktakeLine', 'WmsStocktakeLocation'], ['src/lib/wms/stocktake-service.ts', 'src/lib/wms/stocktake-print-service.ts'], 'PARTIAL', '库位批次盘点与差异过账、FULL/SAMPLE/有依据 ACTIVITY、盲盘及受控打印；所有状态的盲盘打印隐藏基准/差异。源全部样式未逐项对等。'
    if table in ['t_erp_inwh_form', 't_erp_inwh_form_entry']:
        return ['WmsReceipt', 'WmsReceiptLine', 'WmsLot'], ['src/lib/wms/receipt-service.ts', 'src/lib/procurement/receipt-service.ts'], 'TARGET_REUSE', '采购/收货、质检、上架及拒收退回，沿目标端事务。'
    if 'outwh_form' in table:
        return ['WmsOutbound', 'WmsOutboundLine', 'WmsReservation'], ['src/lib/wms/outbound-draft-service.ts', 'src/lib/wms/consumable-service.ts'], 'TARGET_REUSE', '多行出库需求与批次分配、预占/拣货/出库、耗材。'
    if table == 't_erp_warehouse':
        return ['WmsWarehouse', 'WmsArea'], ['src/lib/wms/catalog-service.ts'], 'TARGET_REUSE', '复用现有仓库事实源。'
    if table == 't_erp_warehouse_address':
        return ['WmsWarehouseAddress'], ['src/lib/wms/catalog-details-service.ts'], 'TARGET_REUSE', '地址和运输单据地址快照。'
    if table == 't_erp_warehouse_type':
        return ['WmsWarehouseType'], ['src/lib/wms/catalog-details-service.ts'], 'TARGET_REUSE', '自定义仓库类型。'
    if table == 't_erp_warehouse_shelf':
        return ['WmsLocation'], ['src/lib/wms/location-freeze-service.ts', 'src/lib/wms/catalog-details-service.ts'], 'TARGET_REUSE', '库位、树、冻结和容量。'
    if table == 't_erp_whse_unsalable_rpt':
        return ['WmsMovement', 'WmsAgingSnapshot', 'WmsAgingSchedule', 'WmsInventoryRiskAssessment'], ['src/lib/wms/stock-aging-query.ts', 'src/lib/wms/aging-snapshot-service.ts', 'src/lib/wms/aging-schedule-service.ts', 'src/lib/wms/inventory-risk-service.ts'], 'PARTIAL', '库龄证据/当日快照/默认关闭调度、显式销量窗口与 NRV 跌价评估、独立复核及总账来源；缺数保持 NEEDS_DATA，不冒充实际销量自动采集。'
    if table.startswith('t_erp_inventory') or 'shelf_inventory' in table:
        return ['WmsStockBalance', 'WmsMovement', 'WmsCommand'], ['src/lib/wms/reconciliation.ts', 'src/lib/wms/inventory-history-query.ts', 'src/lib/wms/inventory-period-summary.ts'], 'PARTIAL', '数量账、区间重建及UTC日/月分类收发存、调拨/转换/盘盈盘亏守恒；未配置周转制度返回null，不猜源周转公式或历史数据。'
    return ['FbaLocalPlan', 'FbaLocalShipment', 'FbaExternalOperationRecord', 'FbaRemoteAction', 'FbaRemoteReadSnapshot'], ['src/lib/fba-local/service.ts', 'src/lib/fba-local/external-operation-service.ts', 'src/lib/fba-local/remote-action-executor.ts', 'src/lib/fba-local/remote-read-snapshot.ts'], 'PARTIAL', '计划/装箱/物流/费用/报关、远程执行/异步回读、计划站点/标签计划行范围、134请求及响应DTO投影；只读失败可结束后独审批新请求，写未知不重发。分页观察与公司仓事实分离；真实授权/配额来源未验收。'


def build():
    rows = []
    candidates = json.loads(MEMBERSHIP.read_text())
    seen = {row['table'] for row in candidates}
    v2 = SOURCE / 'wimoor-amazon/amazon-boot/src/main/java/com/wimoor/amazon/inboundV2/pojo/entity'
    for entity in sorted(v2.glob('*.java')):
        content = entity.read_text()
        match = re.search(r'@TableName\("([^"\n]+)"\)', content)
        if match and match.group(1) not in seen:
            candidates.append({'scope': 'FBA V2: direct entity TableName annotation', 'table': match.group(1), 'status': 'ANNOTATION_VERIFIED', 'ownership': 'source module reference; exclusive ownership not inferred', 'sourceEntity': str(entity), 'sourceEntitySha256': hashlib.sha256(entity.read_bytes()).hexdigest()})
            seen.add(match.group(1))
    for candidate in candidates:
        table = candidate['table']
        models, services, status, boundary = mapping(table)
        missing_models = [name for name in models if name not in MODELS]
        # Keep names grounded in current schema; a missing model is a gap, not an alias.
        paths = sorted(SOURCE.glob(f'init-config/mysql/数据库结构/*/{table}.sql'))
        evidence = []
        for path in paths:
            data = path.read_bytes()
            columns = re.findall(r'^\s*`([^`]+)`\s+([\w(),]+)', data.decode(errors='replace'), re.M)
            evidence.append({'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(), 'columns': columns})
        for path in services:
            assert (ROOT / path).is_file(), path
        rows.append({**candidate, 'sourceDdl': evidence, 'targetModels': [name for name in models if name in MODELS], 'unresolvedModelNames': missing_models, 'targetServices': services, 'status': status, 'boundary': boundary, 'fullSourceParityVerified': False})
    output = ROOT / 'docs/wimoor-integration/evidence/three-core-current-coverage.json'
    output.write_text(json.dumps({'scope': 'candidate membership remains inferred; code inventory is not source parity or production acceptance', 'rows': rows}, ensure_ascii=False, indent=2) + '\n')
    lines = ['# 三域候选表与当前代码覆盖', '', '候选来自原证据索引；所有行 fullSourceParityVerified=false。TARGET_REUSE 仅表示已有目标端服务承担该职责，不证明源字段/规则逐项对等。源 DDL 哈希及列清单在同名 JSON；并行 DDL 副本未自动裁决。', '', '| 候选源表 | 当前状态 | 目标模型 | 边界 |', '| --- | --- | --- | --- |']
    for row in rows:
        lines.append(f"| `{row['table']}` | {row['status']} | {', '.join(row['targetModels']) or '未建独立实现'} | {row['boundary']} |")
    (ROOT / 'docs/wimoor-integration/three-core-current-coverage.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'rows': len(rows), 'missingModelNames': sorted({name for row in rows for name in row['unresolvedModelNames']}), 'sourceDdlFound': sum(bool(row['sourceDdl']) for row in rows)}, ensure_ascii=False))


if __name__ == '__main__':
    build()

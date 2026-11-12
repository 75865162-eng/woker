#!/usr/bin/env python3
"""Build review datasets from the source scan and explicit P0-A decisions.

No application configuration, DB access, package installation or remote requests.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=pathlib.Path, required=True)
    parser.add_argument('--erp', type=pathlib.Path, required=True)
    args = parser.parse_args()
    folder = args.evidence
    load = lambda key: json.loads((folder / (key+'.json')).read_text())
    source = pathlib.Path(load('summary')['source'])
    erp = args.erp.resolve()
    tables, entities, mappers = load('tables'), load('entities'), load('mapper_statements')
    table_keys = {(t['database'], t['table']) for t in tables}
    wms = sorted({x['table'] for x in entities if x['table'] and '/erp/' in x['path'] and any('/'+domain+'/' in x['path'] for domain in ['inventory', 'warehouse', 'stock'])})
    inbound = sorted({x['table'] for x in entities if x['table'] and '/amazon/inbound/' in x['path']})
    finance = sorted({table for database, table in table_keys if database == 'db_finance' and table.startswith('fin_')} | {x['table'] for x in entities if x['table'] and '/erp/finance/' in x['path']})
    module_counts = [dict(scope=k, candidate_tables=len(v), identities=v, ownership='INFERRED; source selection only, not exclusive ownership or shared-table census') for k, v in [('WMS: ERP inventory+warehouse+stock annotations', wms), ('FBA: Amazon inbound annotations only', inbound), ('Finance: db_finance fin_* + ERP finance annotations', finance)]]
    module_membership = [dict(scope=row['scope'], table=table, status='INFERRED', ownership='candidate membership; exclusive/shared ownership pending') for row in module_counts for table in row['identities']]
    for row in module_counts:
        row['identities'] = 'see Module membership sheet / module_membership.json'
    target_map = {'t_erp_warehouse': 'WmsWarehouse/WmsArea', 't_erp_warehouse_shelf': 'WmsLocation', 't_erp_inventory': 'WmsStockBalance', 't_erp_inventory_record': 'WmsMovement', 't_erp_inwh_form': 'WmsReceipt', 't_erp_inwh_form_entry': 'WmsReceiptLine', 't_erp_outwh_form': 'WmsReservation', 't_erp_outwh_form_entry': 'WmsReservation', 't_erp_warehouse_shelf_inventory': 'WmsStockBalance', 't_erp_warehouse_shelf_inventory_opt_record': 'WmsMovement'}
    table_review = []
    table_references = []
    for table in tables:
        name = table['table']
        refs = sorted({e['path'] for e in entities if e['table'] == name})
        statements = [m for m in mappers if name in m['tables'].split(',')]
        table_review.append({**table, 'entity_sources': len(refs), 'mapper_sources': len(statements), 'reference_details': 'Table references sheet / table_references.json; joined by source table name, DB ownership requires review', 'target': target_map.get(name, '未确定；后续所属域复核'), 'decision': 'PROPOSED: minimal WMS model; see p0b-wms-change-list.md' if name in target_map else 'UNCERTAIN: not approved for migration', 'ownership': 'shared/exclusive not inferred from table name'})
        for ref in refs:
            table_references.append(dict(database=table['database'], table=name, kind='entity annotation', source=ref, status='INFERRED'))
        for m in statements:
            table_references.append(dict(database=table['database'], table=name, kind='Mapper '+m['action'], source=f"{m['path']}:{m['line']} [{m['statement']}]", status='INFERRED'))
    base = 'wimoor-erp/erp-boot/src/main/java/com/wimoor/erp/'
    inv = base+'inventory/service/impl/InventoryServiceImpl.java'
    rules = []
    source_rules = [
        ('WMS-01', inv, 112, 'isOkForOperate', '仓库不存在/停用/盘点时拒绝', 'warehouse enable guard; stocktaking P0-D'),
        ('WMS-02', inv, 181, 'AddStockByStatus/SubStockByStatus', '余额、流水和历史，Mapper FOR UPDATE', 'one PG transaction, guarded balance and append-only movement'),
        ('WMS-03', inv, 198, 'AddStockByStatus', 'ishungry 对 fulfillable 允许负数', 'exclude negative-stock option'),
        ('WMS-04', inv, 432, 'inStockByReady', 'Ready 待入；alReady 待入转可用', 'receive pendingQc -> inspect -> pendingPutaway -> storage'),
        ('WMS-05', inv, 453, 'outStockByReady', 'fulfillable 转 outbound，完成再减 outbound', 'reserve without physical loss, pick, dispatch'),
        ('WMS-06', base+'stock/controller/InWarehouseFormController.java', 79, 'addDataAction', 'Controller transaction -> saveAction/saveForm -> inventory agent', 'application-service owns whole-document transaction'),
        ('WMS-07', base+'stock/controller/OutWarehouseFormController.java', 400, 'addData', 'Controller transaction -> outbound form entries -> inventory', 'idempotent dispatch and immutable movement'),
        ('WMS-08', base+'warehouse/service/impl/WarehouseShelfInventoryServiceImpl.java', 430, 'add/sub', '库位数量、余额与操作记录；sub 检查不足', 'one location ledger; no parallel shelf truth'),
    ]
    for rid, path, line, method, rule, target in source_rules:
        rules.append(dict(id=rid, status='VERIFIED', source=f'{path}:{line}', class_method=method, trigger=method, rule=rule, target=target, transaction='annotation and call-chain evidence only; no source runtime verification', exceptions='see p0b-wms-change-list.md', test='proposed WMS unit + isolated PG/HTTP; not run'))
    rules.extend([dict(id='WMS-P-'+str(i+1), status='INFERRED', source='docs/wimoor-integration/p0b-wms-change-list.md', class_method='PROPOSED target rule', trigger=action, rule=rule, target='P0-B pending shared-boundary confirmation', transaction='PG transaction + revision + one-use approval', exceptions='not a verified Wimoor rule', test='not implemented') for i, (action, rule) in enumerate([
        ('INSPECT', 'accepted/rejected explicit; uninspected never available'),
        ('LOT', 'explicit productRecordId + lotCode; local barcode optional'),
        ('APPROVE', 'new WMS scope; no self approval; no Seller read-grant reuse'),
        ('IDEMPOTENCY', 'same key/hash returns prior result after current authorization; changed hash conflicts'),
    ])])
    capabilities = []
    candidates = [
        ('CAP-PRODUCT', '商品主档关联', 'erp/material', 'src/lib/products/product-record-repository.ts', 'B', '现有主档/revision；缺 WMS 批次关联及复合 FK', '只读关联 ProductRecord，补 scope FK'),
        ('CAP-WAREHOUSE', '公司仓/区域/库位', 'erp/warehouse', 'prisma/schema.prisma;src/lib/logistics/types.ts', 'C', '全 Schema 未见公司仓模型；Logistics 为文件/装箱类型', '新建 Warehouse/Area/Location，不复用 Amazon 仓快照'),
        ('CAP-RECEIPT', '收货/质检/上架', 'erp/stock', 'prisma/schema.prisma;src/app/logistics/page.tsx', 'C', '未见公司仓收货/质检/上架事实及业务路由', 'Receipt/Line/Lot + three explicit stock buckets'),
        ('CAP-RESERVE', '预留/释放/拣货/出库', 'erp/inventory', 'prisma/schema.prisma;src/lib/amazon/inventory.ts', 'C', '外部库存读取不提供公司仓预留/出库', 'Reservation + command application service'),
        ('CAP-LEDGER', '库存流水与并发幂等', 'erp/inventory', 'prisma/schema.prisma;src/lib/amazon-sync/snapshots.ts', 'C', '外部时点快照不是公司仓流水', 'StockBalance/Movement/Command; DB constraints + concurrency'),
        ('CAP-ACCESS', 'ERP 库存业务权限/审批', 'erp/stock', 'src/lib/auth/api-permissions.ts;src/lib/accounts/permissions.ts;src/lib/workspace/access.ts', 'B', '已有登录/模块动作/组织；缺库存权限和事务内单次审批', '独立 WMS business module id, no inherited logistics writer'),
        ('CAP-FBA', 'FBA Inbound V2 创建与确认', 'amazon/inbound', 'src/lib/amazon/sp-api-client.ts;src/lib/amazon-sync/inbound.ts', 'B', '已有 2024 read operations；不等于创建/装箱/分仓写流程', '保留采集；P0-C 独立写 service/approval/async recovery'),
        ('CAP-QUERY', 'ERP/MCP 统一查询', 'amazon/report', 'src/lib/amazon-sync/mcp-tool-registry.ts;src/lib/amazon-sync/mcp.ts;src/lib/agent-platform/tool-gateway.ts', 'B', '已有 registry/gateway；尚无公司仓 query-service', '新公司仓 query-service；本批不扩 MCP 写工具'),
        ('CAP-FINANCE', '采购/成本/AP/AR/总账', 'finance', 'prisma/schema.prisma;src/components/operations/finance-workbench.tsx;src/lib/amazon-sync/finance.ts', 'B', '现有 Amazon 财务解析查询；无据认定采购或总账闭环', 'P1/P2 定向复核；本批不建财务表'),
        ('CAP-WORKER', '后台任务承接', 'common/service', 'src/lib/runtime/worker-registry.json;scripts/runtime/worker-manager.mjs', 'B', '已有注册 Worker；P0-B 同步事务无需新消费者', '保留 Worker，Wimoor Quartz 不移植运行架构'),
        ('CAP-NEGATIVE', '允许负库存选项', 'erp/inventory', 'docs/wimoor-sp-api-port-plan.md', 'E', '与本计划负可用库存保护冲突', '不引入 ishungry 开关'),
    ]
    for cid, name, scope, paths, category, gap, change in candidates:
        source_files = [f"{m['path']}:{m['line']}" for m in load('methods') if '/'+scope+'/' in m['path']][:4]
        capabilities.append(dict(id=cid, capability=name, wimoor_evidence='\n'.join(source_files) or 'see source module index; deep semantic review pending', erp_files=paths, classification=category, field_gap=gap, change=change, dependency='WMS shared Schema/permission/API confirmation' if 'WMS' in gap or cid.startswith('CAP-') else 'domain review', risk='tenant isolation, revision and no negative stock' if cid not in ['CAP-FBA','CAP-FINANCE'] else 'external/financial write boundary remains closed', acceptance='p0b-wms-change-list.md isolation/HTTP scenarios; no runtime completeness claimed', owner='待分配', status='REVIEWED_SOURCE_ONLY' if cid not in ['CAP-FINANCE','CAP-WORKER'] else 'INITIAL_DOMAIN_REVIEW'))
    # Keep actual ERP/source fingerprints for each decision; no file bodies/config.
    erp_files = sorted({file for row in capabilities for file in row['erp_files'].split(';')} | {'src/lib/workspace/access.ts', 'src/lib/accounts/role-definitions.ts', 'src/lib/auth/session.ts', 'src/lib/accounts/role-permissions-server.ts', 'src/lib/accounts/role-catalog-server.ts', 'src/app/api/accounts/team-members/route.ts'})
    erp_evidence = [dict(path=f, sha256=hashlib.sha256((erp/f).read_bytes()).hexdigest()) for f in erp_files if (erp/f).is_file()]
    operations = []
    current = (erp/'src/lib/amazon/sp-api-client.ts').read_text()
    for match in re.finditer(r'(?m)^  async (\w+)\(', current):
        operations.append(dict(operation=match[1], erp_source=f'src/lib/amazon/sp-api-client.ts:{current.count(chr(10),0,match.start())+1}', status='CODE_PRESENT_NOT_REAL_VERIFIED', source='current working tree', schema='official operation/field evidence still required'))
    guide = pathlib.Path('/Users/chenjieliang/Desktop/亚马逊官方文档 SP-API新人配置指南.md')
    guide_hash = hashlib.sha256(guide.read_bytes()).hexdigest()
    modernization = []
    api_groups = [
        ('Orders', 'getOrders/getOrder', 'searchOrders/getOrder', 'v0', '2026-01-01', 'ERP searchOrders/getOrder present', '旧 v0 2027-03-27 移除（本地指南）；当前 ERP 不走旧入口'),
        ('Catalog Items', 'getCatalogItem/searchCatalogItems', 'getCatalogItem/searchCatalogItems', 'v0/2020-12-01', '2022-04-01', 'ERP getCatalogItem present; search needs operation review', '不因 SDK 有方法宣称 ERP 已支持'),
        ('Listings Items', 'getListingsItem/searchListingsItems/putListingsItem/patchListingsItem/deleteListingsItem', 'same operations require schema review', '2020-09-01', '2021-08-01', 'ERP read present; write not established', 'write remains closed'),
        ('FBA Inventory', 'getInventorySummaries', 'getInventorySummaries', 'v1', 'v1', 'ERP read present', 'FBA snapshot does not mutate company stock'),
        ('Fulfillment Inbound', 'createInboundShipmentPlan/createInboundShipment', 'createInboundPlan', 'v0', '2024-03-20', 'ERP read-only 2024; old Wimoor create calls found', 'BLOCK PORT: old create operations removed 2025-01-21 per guide; no current ERP removed write found'),
        ('Finances', 'listFinancialEvents', 'listTransactions', 'v0', '2024-06-19', 'ERP listTransactions present', 'v0 2027-08-27 移除（指南）；ERP已用新版，不改运行管道'),
        ('Reports', 'createReport/getReport/getReports/getReportDocument', 'same operations', '2021-06-30', '2021-06-30', 'ERP lifecycle methods present', '报告类型退役另核；不能把 Reports API 标成已退役'),
        ('Feeds', 'createFeed/createFeedDocument/getFeed/getFeedDocument', 'same operation candidates', '2021-06-30', '2021-06-30', 'ERP class method scan has no feed write', 'P0-B not dependent'),
        ('Notifications', 'getSubscriptions/createSubscription/deleteSubscription', 'same operation candidates', 'v1', 'v1', 'ERP getSubscriptions read present', 'source availability not role authorization'),
        ('Data Kiosk', 'createQuery/getQuery/getQueries/getDocument/cancelQuery', 'schema operation list pending', 'unknown', '2023-11-15 per local guide, verify schema', 'ERP no operation in client scan', 'do not enable without schema/roles'),
        ('Pricing', 'getPricing', 'getPricing/getCompetitiveSummary', 'v0', 'v0 / 2022-05-01', 'ERP read and competitive-summary batch present', 'cannot infer all v0 removed'),
        ('Fees', 'getMyFeesEstimateForSKU/getMyFeesEstimateForASIN/getMyFeesEstimates', 'schema operation list pending', 'v0', 'v0', 'no fee-estimate method found in ERP client', 'not fee report parser; do not conflate'),
    ]
    for domain, oldops, targetops, oldver, targetver, erp_state, decision in api_groups:
        modernization.append(dict(domain=domain, old_operations=oldops, target_operations=targetops, old_version=oldver, target_version=targetver, erp=erp_state, decision=decision, local_guide=f'{guide} sections 16/18; sha256={guide_hash}', official_schema='NOT_ACQUIRED for these operation schemas; no online fetch', fields_roles_limits_pagination='UNCERTAIN: per-operation request/response/roles/limits/async/retirement verification pending; do not default-enable', status='INITIAL_MATRIX'))
    # Inbound target operation names are candidates until official schema is acquired.
    for op in ['createInboundPlan','listInboundPlanItems','generatePackingOptions','listPackingOptions','confirmPackingOption','setPackingInformation','generatePlacementOptions','listPlacementOptions','confirmPlacementOption','getShipment','generateTransportationOptions','listTransportationOptions','confirmTransportationOptions','generateDeliveryWindowOptions','listDeliveryWindowOptions','confirmDeliveryWindowOptions','getShipmentLabels','updateShipmentTrackingDetails','getInboundOperationStatus']:
        modernization.append(dict(domain='Fulfillment Inbound V2', old_operations='see Wimoor SDK/source candidates', target_operations=op, old_version='v0 or 2024 SDK candidates', target_version='2024-03-20 target', erp='read operation subset only; no write approval/executor established', decision='P0-C schema gate; candidate not official contract proof', local_guide=str(guide), official_schema='NOT_ACQUIRED', fields_roles_limits_pagination='UNCERTAIN', status='UNCERTAIN'))
    ads = []
    for domain, area, target in [('SP','Campaign/AdGroup/Keyword/Target/ProductAd LIST/GET','schema/media type verification pending'), ('SB','Campaign/AdGroup/Ads LIST/GET v3/v4','per operation v3/v4; do not upgrade whole domain blindly'), ('SD','Campaign/AdGroup/Target/Ads LIST/GET','schema/media type verification pending'), ('Reporting','createReport/getReport/download v3','retain existing transport; schema comparison pending'), ('Export','Snapshot -> Export/create/get/download','P2; operation+retirement proof pending')]:
        ads.append(dict(domain=domain, area=area, target=target, erp='src/lib/amazon-ads/reporting-v1-transport.ts; src/lib/amazon-ads/entity-replica.ts; src/lib/amazon-ads/query-service.ts', source='see API inventory for Wimoor methods; SDK names not official evidence', fields_roles_limits_pagination='UNCERTAIN', schema='NOT_ACQUIRED; no online access', decision='P0-B no Ads change; removed-operation impact not established', status='INITIAL_MATRIX'))
    fields = []
    for column in load('columns'):
        if column['table'] in target_map:
            mapped = {'shopid':'organizationId/workspaceId (explicit mapping; not direct copy)', 'warehouseid':'warehouseId (scope FK)', 'materialid':'lotId -> productRecordId (explicit mapping)', 'quantity':'onHand / bucket-specific field (status reviewed)', 'status':'explicit target buckets; no enum ordinal copy', 'operator':'actorUserId (current ERP identity)', 'opttime':'occurredAt (source timezone must be known)', 'id':'new stable id; source evidence reference only', 'formid':'receiptId/sourceId (typed relationship)', 'amount':'expectedQty/receivedQty/requestedQty per action'}.get(column['column'], 'per-column semantic decision pending')
            fields.append(dict(source_table=column['table'], source_column=column['column'], source_type=column['type'], nullable=column['nullable'], source_default=column['default'], source=f"{column['path']}:{column['line']}", target_model=target_map[column['table']], target_field=mapped, identity='organization+workspace+warehouse/location+product/lot; no Amazon seller inference', conversion='no business data import in P0-B', unit='integer physical units; no money conversion', decision='PROPOSED' if 'pending' not in mapped else 'UNCERTAIN'))
    datasets = dict(table_review=table_review, table_references=table_references, rules=rules, capabilities=capabilities, module_counts=module_counts, module_membership=module_membership, erp_evidence=erp_evidence, erp_operations=operations, sp_modernization=modernization, ads_modernization=ads, model_mapping=fields)
    for key, value in datasets.items():
        (folder/(key+'.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k: len(v) for k, v in datasets.items()}, ensure_ascii=False))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Enrich the immutable 729-file inventory; never discover or overwrite inventory files.

No application config, database, network, or upstream executable code is loaded.
"""
import hashlib
import json
import posixpath
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/wimoor-integration/ui/2026-11-12'
INVENTORY = OUT / 'source-inventory.json'
STATES = ['未分析', '已分析', '已完成 UI 移植', '已接入真实 ERP 数据', '已接入真实业务操作', '已完成隔离测试', '已验收', '明确不移植及原因']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def imports(text):
    # Static and lazy imports, including extensionless @/ aliases. Not a Vue compiler.
    pattern = r'''\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]'''
    return [(next(g for g in m.groups() if g), text[:m.start()].count('\n') + 1) for m in re.finditer(pattern, text)]


def resolve(base, literal, ui):
    if literal.startswith('@/'):
        path = 'src/' + literal[2:]
    elif literal.startswith('.'):
        path = posixpath.normpath(posixpath.join(posixpath.dirname(base), literal))
    else:
        return None
    for candidate in [path, path + '.vue', path + '/index.vue']:
        if candidate.endswith('.vue') and (ui / candidate).is_file():
            return candidate
    return None


def decode_js_string(value):
    # Paths here use slash/backslash escapes; do not interpret Chinese as unicode_escape.
    return re.sub(r'\\([\\/\'" ])', r'\1', value)


def route_objects(text):
    # Balanced lexical objects avoid pairing paths with imports from different children.
    token = re.compile(r'''//[^\n]*|/\*[\s\S]*?\*/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[{}]|\b(?:path|name|component)\b\s*:''')
    stack, objects = [], []
    for m in token.finditer(text):
        value = m.group()
        if value == '{':
            obj = {'start': m.start(), 'parent': stack[-1] if stack else None, 'fields': {}}
            stack.append(obj)
        elif value == '}' and stack:
            obj = stack.pop()
            obj['end'] = m.end()
            objects.append(obj)
        elif stack and value.endswith(':'):
            key = value[:-1].strip()
            tail = text[m.end():]
            if key in ['path', 'name']:
                match = re.match(r'''\s*(['"])((?:\\.|(?!\1).)*?)\1''', tail)
                if match:
                    stack[-1]['fields'][key] = decode_js_string(match.group(2))
            else:
                match = re.match(r'''\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]''', tail)
                if match:
                    stack[-1]['fields']['component'] = match.group(1)
    return objects


def capability(route, components, api_files, services, gaps):
    files = components + api_files + services
    for path in files:
        assert (ROOT / path).is_file(), path
    return {'route': route, 'reactComponents': components, 'apiFiles': api_files,
            'services': services, 'remaining': gaps,
            'evidence': [{'file': p, 'sha256': digest(ROOT / p)} for p in files]}


def main():
    preserved = {str(p.relative_to(ROOT)): digest(p) for p in [INVENTORY, OUT / 'page-inventory.md']}
    original = json.loads(INVENTORY.read_text())
    ui = Path(original['sourceRoot']) / 'wimoor-ui'
    pages = original['pages']
    assert len(pages) == original['vueFiles'] == 729
    sources = {p['source'] for p in pages}
    assert len(sources) == 729
    texts = {}
    for p in pages:
        file = ui / p['source']
        assert digest(file) == p['sha256'], f"Upstream drift: {file}; preserve snapshot and review explicitly"
        texts[p['source']] = file.read_text()
    routes = defaultdict(list)
    for router in original['routers']:
        file = ui / router['source']
        assert digest(file) == router['sha256'], f'Router drift: {file}'
        text = file.read_text()
        for obj in route_objects(text):
            fields = obj['fields']
            if 'component' not in fields or 'path' not in fields:
                continue
            component = resolve(router['source'], fields['component'], ui)
            if component not in sources:
                continue
            path, parent = fields['path'], obj['parent']
            while parent and not path.startswith('/'):
                prefix = parent['fields'].get('path')
                if prefix is not None:
                    path = prefix.rstrip('/') + '/' + path
                parent = parent['parent']
            path = '/' + path.lstrip('/')
            routes[component].append({'path': path, 'name': fields.get('name'),
                                      'router': router['source'], 'line': text[:obj['start']].count('\n') + 1})
    deps, reverse = {}, defaultdict(list)
    for source, text in texts.items():
        deps[source] = []
        for literal, line in imports(text):
            target = resolve(source, literal, ui)
            if target:
                deps[source].append({'source': target, 'line': line, 'literal': literal, 'inSnapshot': target in sources})
                reverse[target].append(source)

    ops = 'src/components/operations/'
    api = 'src/app/api/operations/'
    capabilities = {
        'purchase': capability('/operations?view=purchase-orders', [ops+'procurement-workbench.tsx', ops+'purchase-payment-records.tsx'], [api+'procurement/route.ts', api+'procurement/approvals/route.ts'], ['src/lib/procurement/query-service.ts', 'src/lib/procurement/order-service.ts', 'src/lib/procurement/receipt-service.ts'], ['Wimoor 自动价格、整套打印与物流记录未逐项对等移植；付款退款业务链尚需独立临时库验收']),
        'supplier': capability('/operations?view=suppliers', [ops+'procurement-workbench.tsx', ops+'purchase-supplier-picker.tsx'], [api+'procurement/route.ts'], ['src/lib/procurement/query-service.ts', 'src/lib/procurement/order-service.ts'], ['供应商扩展字段、上游专属批量导入导出未逐项移植']),
        'orders': capability('/operations?view=orders', [ops+'orders-workbench.tsx', ops+'order-items-workbench.tsx'], [api+'sync-center/route.ts'], ['src/lib/amazon-sync/orders-query.ts'], ['ERP 接入订单查询和详情；Wimoor FBM 发货、退款等写操作未作为本次移植完成']),
        'stores': capability('/operations?view=connections', [ops+'amazon-stores-panel.tsx'], [api+'amazon-stores/route.ts'], ['src/lib/amazon-sync/stores.ts'], ['仅 ERP 名称维护与已有 OAuth 入口；Wimoor 广告授权结果页未移植，真实 Amazon 授权未验证']),
        'wms': capability('/logistics/warehouse?tab=warehouses', [ops+'wms-workbench.tsx'], [api+'wms/[kind]/route.ts'], ['src/lib/wms/query-service.ts', 'src/lib/wms/catalog-service.ts', 'src/lib/wms/receipt-service.ts'], ['保留 ERP 仓库/收货/库存权限和状态机；第三方海外仓接口未移植']),
        'wms-outbound': capability('/logistics/warehouse?tab=outbounds', [ops+'wms-workbench.tsx'], [api+'wms/[kind]/route.ts', api+'wms/commands/route.ts'], ['src/lib/wms/query-service.ts', 'src/lib/wms/catalog-service.ts', 'src/lib/wms/outbound-draft-service.ts', 'src/lib/wms/application-service.ts'], ['只创建/编辑/取消出库需求草稿；实际分配、拣货、出库另经预占与审批状态机；未提供上游日期筛选、Excel 导入导出、批量删除和打印']),
        'wms-stocktake': capability('/logistics/warehouse?tab=stocktakes', [ops+'wms-workbench.tsx', ops+'wms-stocktake-panel.tsx'], [api+'wms/[kind]/route.ts', api+'wms/commands/route.ts', api+'wms/approvals/route.ts'], ['src/lib/wms/query-service.ts', 'src/lib/wms/catalog-service.ts', 'src/lib/wms/stocktake-service.ts', 'src/lib/wms/application-service.ts', 'src/lib/wms/approvals.ts'], ['仅 ERP 自有仓的库位/批次盘点与独立过账审批；不支持上游海外仓盘点模式、盘点 Excel 导入、打印及全字段备注']),
        'transfer': capability('/logistics/warehouse?tab=transfer-orders', [ops+'wms-workbench.tsx', ops+'wms-transfer-orders.tsx', ops+'wms-transfer-table.tsx'], [api+'wms/[kind]/route.ts', api+'wms/commands/route.ts', api+'wms/approvals/route.ts'], ['src/lib/wms/query-service.ts', 'src/lib/wms/transfer-order-service.ts'], ['状态 Tab/筛选、明细表、详情与操作已适配 ERP 合同；上游打印、Excel 导入、预计到达及完整审计时间线未实现']),
        'fba': capability('/operations?view=fba-boxing', [ops+'fba-plan-table.tsx', ops+'fba-local-plans-workbench.tsx', ops+'fba-transport-details.tsx'], [api+'fba-local-plans/route.ts'], ['src/lib/fba-local/service.ts', 'src/lib/fba-local/transport-service.ts', 'src/lib/fba-local/shipment-service.ts'], ['仅本地计划/箱规/物流操作；Amazon 创建计划、生成确认装箱方案、标签和实际发货未接入']),
        'amazon-fulfillment': capability('/operations?view=fulfillment', [ops+'observations-workbench.tsx', ops+'sync-center-workbench.tsx'], ['src/app/api/operations/sync-center/route.ts'], ['src/lib/amazon-sync/observations-query.ts', 'src/lib/amazon-sync/observation-business-fields.ts'], ['仅按已批准计划范围显示已发布 Amazon 入库计划/货件/商品观察数据；没有上游全部状态 Tab 的等价聚合、发货/标签/物流写操作，也不混同本地 FBA 发货计划。']),
        'expense': capability('/operations?view=expense-management', [ops+'unconnected-business-workbench.tsx'], [], [], ['通用请款 API 缺失', '通用请款 Service 缺失', '通用费用单/核销数据库模型缺失；禁用筛选，无业务数据和成功操作']),
        'product-candidate': capability('/dashboard', ['src/components/products/product-workbench.tsx'], ['src/app/api/products/route.ts'], ['src/lib/products/product-detail-service.ts', 'src/lib/products/product-aggregate-service.ts'], ['已有商品主档能力；未证明对应 Wimoor 文件已移植，不能从入口存在推定完成']),
        'product-center': capability('/dashboard', ['src/components/products/product-workbench.tsx', 'src/components/products/product-workbench-shell.tsx', 'src/components/products/product-editor-image-panel.tsx', 'src/components/products/product-workbook-detail-sections.tsx'], [api+'products/route.ts', 'src/app/api/products/[sku]/detail/route.ts', 'src/app/api/products/[sku]/route.ts', 'src/app/api/products/image-assets/upload/route.ts'], ['src/lib/products/product-detail-service.ts', 'src/lib/products/product-aggregate-service.ts', 'src/lib/products/product-record-repository.ts'], ['只接 ERP ProductRecord 已有字段和编辑/图片闭环；不展示 Wimoor 库存数量、阶梯报价/税率字段、图片占位或库存警告；商品记录仍由 ERP revision/审计/Outbox 管理']),
        'amazon-reports': capability('/operations?view=sales-traffic', [ops+'domain-reports-workbench.tsx', ops+'sync-center-workbench.tsx'], [api+'sync-center/route.ts'], ['src/lib/amazon-sync/domain-reports-query.ts', 'src/lib/amazon-sync/domain-reports.ts', 'src/lib/amazon-sync/sales-query.ts'], ['只适配结算原始行、赔偿、库龄快照与库存事件对应的真实报告；费用公式、SKU 聚合分摊、促销绩效等仍无等价后端口径']),
        'listing-candidate': capability('/operations?view=listing_details', [ops+'observations-workbench.tsx'], [api+'sync-center/route.ts'], ['src/lib/amazon-sync/observations-query.ts'], ['外部 Listing 观察不覆盖 ProductRecord，不等于 Wimoor Listing 发布编辑']),
        'finance-candidate': capability('/operations?view=finance', [ops+'finance-workbench.tsx'], [api+'sync-center/route.ts'], ['src/lib/amazon-sync/finance-query.ts'], ['仅交易查询；利润测算、费用公式、ERP 会计凭证均非等价能力']),
        'settlement-candidate': capability('/operations?view=settlements', [ops+'domain-reports-workbench.tsx'], [api+'sync-center/route.ts'], ['src/lib/amazon-sync/domain-reports-query.ts'], ['已有结算报告及行详情；未逐文件验证 Wimoor SKU 结算分摊口径']),
        'reports-candidate': capability('/operations?view=sales-traffic', [ops+'domain-reports-workbench.tsx'], [api+'sync-center/route.ts'], ['src/lib/amazon-sync/sales-query.ts', 'src/lib/amazon-sync/domain-reports-query.ts'], ['只复用 ERP 已授权报表；上游日周月分组和列配置未逐项适配']),
        'inventory-candidate': capability('/operations?view=inventory', [ops+'operations-hub-workbench.tsx'], [api+'inventory/snapshots/route.ts'], ['src/lib/amazon-sync/read.ts'], ['已有库存快照及详情，不代表上游数量/货值空模板或预测功能已移植']),
    }
    # Exact files only. No directory-wide completion inheritance.
    ledger = {}
    def port(paths, cap, scope, data=False, operation=False, route=None):
        for p in paths:
            source = 'src/views/' + p
            assert source in sources, source
            ledger[source] = {'capability': cap, 'implementedScope': scope, 'ui': True,
                              'data': data, 'operation': operation, 'route': route}
    port(['erp/purchase/orders/index.vue'], 'purchase', '状态 Tab、筛选、列表、创建/详情及 ERP 审批下单收货入口', True, True)
    port(['erp/baseinfo/supplier/index.vue', 'erp/baseinfo/supplier/components/table.vue'], 'supplier', '供应商搜索、分页列表、创建编辑入口', True, True)
    port(['amazon/order/fbm/components/order_detail.vue'], 'orders', '订单/商品分区详情、已有商品明细跳转', True)
    port(['amazon/storeAuth/index.vue', 'amazon/storeAuth/components/table.vue'], 'stores', '店铺站点授权列表与 ERP 显示名称维护', True, True)
    port(['erp/warehouse/base/index.vue'], 'wms', '现有 WMS 分层入口和仓库查询/建档操作', True, True)
    port(['erp/warehouse/inbound/index.vue'], 'wms', '现有 WMS 收货查询/详情和收货入口', True, True, '/logistics/warehouse?tab=receipts')
    port(['erp/warehouse/transfer/index.vue'], 'transfer', '调拨单据表格、状态/数量、详情及已有审批操作', True, True)
    port(['erp/warehouse/transfer/components/header.vue'], 'transfer', 'ERP 状态 Tab、状态/精确单号筛选、分页；未增加不支持的仓库/日期筛选', True)
    port(['erp/warehouse/transfer/components/details.vue'], 'transfer', '单据资料分区、批次库位/计划已发已收在途明细、按单据查看审批', True, True)
    port(['erp/warehouse/transfer/components/create.vue'], 'transfer', '单据头表单→库存明细表→保存草稿，失败保留输入和内容绑定幂等键', True, True)
    port(['erp/baseinfo/supplier/supplier_dialog.vue'], 'supplier', '搜索/分页→选中供应商→确认；保留快捷选择，取消不更改采购单', True)
    port(['erp/purchase/orders/components/receipt.vue'], 'purchase', '采购分批收货弹窗、订单依据与商品本批数量/库位、真实 WMS 草稿创建', True, True)
    port(['erp/purchase/orders/components/arrival_record.vue'], 'purchase', '采购订单详情中的实际 WMS 收货进度、批次详情及仓库处理跳转；未移植上游撤销库存和打印动作', True, True, '/operations?view=purchase-orders')
    port(['erp/purchase/orders/components/skuTable.vue'], 'purchase', '采购单商品明细、精度金额、商品备注和订单审批/草稿编辑入口，适配现有 ProductRecord 与采购服务；未移植上游供应商账期和 1688 状态', True, True, '/operations?view=purchase-orders')
    port(['erp/warehouse/inbound/components/details.vue'], 'wms', '收货单详情抽屉：单据/仓库/库位/来源/状态/版本、批次商品和实收质检上架数量；操作留在 WMS 审批流程', True, False, '/logistics/warehouse?tab=receipts')
    port(['erp/warehouse/inbound/components/table.vue'], 'wms', 'ERP 收货记录表格与详情入口；未移植上游批量删除、Excel 导入/导出和创建时间筛选', True, False, '/logistics/warehouse?tab=receipts')
    port(['erp/warehouse/inbound/components/create.vue'], 'wms', 'ERP 收货草稿表单以库位/批次/计划数量建档，收货/质检/上架分阶段作业；不包含上游图片/可用量/采购成本列与 Excel 导入', True, True, '/logistics/warehouse?tab=receipts')
    port(['erp/warehouse/outbound/index.vue'], 'wms-outbound', '出库需求列表、筛选/分页/详情入口与创建操作；ERP 需求草稿不等同上游直接出库单', True, True)
    port(['erp/warehouse/outbound/components/table.vue'], 'wms-outbound', '真实 ERP 出库需求列表字段和逐行详情/编辑/取消入口；删除替换为受状态约束的取消', True, True)
    port(['erp/warehouse/outbound/components/create.vue'], 'wms-outbound', '出库需求表单适配：ERP 草稿创建/编辑、收货方地址承运信息与商品数量；实际库存变化必须经预占/拣货/出库', True, True)
    port(['erp/warehouse/outbound/components/create_dialog.vue'], 'wms-outbound', 'WmsProductPicker 搜索已存在 ProductRecord 并加入出库草稿；不展示无该 API 契约的上游图片/可用量/采购价列', True, True)
    port(['erp/warehouse/outbound/components/details.vue'], 'wms-outbound', '出库需求详情抽屉展示 ERP 单据、仓库、地址/承运与逐 SKU 需求/分配/出库数量；非上游直接发货详情', True)
    port(['erp/warehouse/stocktake/index.vue', 'erp/warehouse/stocktake/components/table.vue'], 'wms-stocktake', '盘点列表、单据状态/仓库筛选与进入盘点作业；仅 ERP WMS 自有仓范围', True, True)
    port(['erp/warehouse/stocktake/components/create.vue'], 'wms-stocktake', '创建 ERP 库位/批次盘点，录入实盘并按 revision 提交盘点命令；限制最多 100 个库位批次', True, True)
    port(['erp/warehouse/stocktake/components/details.vue', 'erp/warehouse/stocktake/components/sku_inventory.vue'], 'wms-stocktake', '盘点详情与账面/实盘差异、批次和库位展示；复用 ERP 盘点服务及独立过账审批，不包括海外仓/导入/打印', True, True)
    port(['erp/baseinfo/material/index.vue', 'erp/baseinfo/material/components/header.vue'], 'product-center', 'Product Center 商品主档列表/搜索/筛选/分页和排序；基于 ProductRecord 列表服务，缺少上游当前库存与库存异常列', True, False, '/dashboard')
    port(['erp/baseinfo/material/details/index.vue', 'erp/baseinfo/material/details/components/listinfo.vue'], 'product-center', '商品详情/基础资料经 ProductDetailService 读取 ProductRecord；完整详情可编辑，外部 Amazon Listing 观察不覆盖主档', True, True, '/dashboard')
    port(['erp/baseinfo/material/editinfo/index.vue', 'erp/baseinfo/material/editinfo/components/base.vue'], 'product-center', '商品基础资料编辑，经现有 revision/CAS、审计和 Outbox 保存 ProductRecord', True, True, '/dashboard')
    port(['erp/baseinfo/material/editinfo/components/purchase.vue'], 'product-center', '商品采购价与供应商字段适配 ProductRecord；上游阶梯采购价、税率和其他成本结构未逐项移植', True, True, '/dashboard')
    port(['erp/baseinfo/material/editinfo/components/specs.vue'], 'product-center', 'ProductRecord 规格字段编辑；保留 ERP 当前字段和保存事务，不重建上游商品结构', True, True, '/dashboard')
    port(['erp/baseinfo/material/photoupload/index.vue'], 'product-center', '图片选择/上传/预览/移除复用 ERP FileObject、图片资源服务及 ProductRecord 引用；未复制上游图片组件或资源', True, True, '/dashboard')
    port(['erp/baseinfo/material/components/record.vue'], 'product-center', '商品列表表格适配 ERP SKU/商品名/状态/负责人/供应商/采购价等 ProductRecord 列；Wimoor 图片成本/可用库存等缺失字段不补造', True, False, '/dashboard')
    port(['amazon/payment/settlement_sku/index.vue', 'amazon/payment/settlement_sku/table.vue', 'amazon/payment/settlement_sku/skutable.vue', 'amazon/payment/settlement_sku/settlement.vue'], 'amazon-reports', '切换 SKU/账期结算两类视图；ERP 复用卖家级结算原件、核验归属的报告行及明细，不累计跨币种金额，不执行上游 SKU 费用合计重算', True, False, '/operations?view=settlements')
    port(['amazon/report/reimbursements_fee/index.vue'], 'amazon-reports', '赔偿报告按站点/日期/SKU/ASIN筛选，列表/详情展示现金与库存数量、币种和原始精度金额；不当作 ERP 财务入账', True, False, '/operations?view=reimbursements')
    port(['amazon/order/order_manager/index.vue', 'amazon/order/order_manager/components/table.vue'], 'orders', 'Amazon 订单查询列表与商品/状态/金额/日期摘要适配 ERP 已授权订单查询和分页；不提供 Wimoor 发票/退款/订单改写操作', True, False, '/operations?view=orders')
    port(['amazon/order/order_manager/components/order_detail.vue'], 'orders', '订单详情只展示当前 ERP Orders API 实际提供的字段和商品明细；买家邮箱/地址等未授权或缺失字段不补造，不提供备注修改、发票/退款写入口', True, False, '/operations?view=orders')
    port(['erp/purchase/orders/components/payment.vue'], 'purchase', '付款退款专用入口/详情 Tab、既有复核申请和确认表单；非上游费用明细全量对等', True, True)
    port(['erp/purchase/orders/components/pay_record.vue'], 'purchase', '付款表格/卡片、方式日期/原币精度/凭据备注；不提供上游直接撤销', True)
    port(['erp/purchase/orders/components/create.vue'], 'purchase', '采购草稿表单复用 ERP 供应商、商品、收货库位、备注与精确金额；不包含上游按供应商批量拆单', True, True, '/operations?view=purchase-orders')
    port(['erp/purchase/orders/components/details.vue'], 'purchase', '采购详情展示 ERP 采购明细、审批、收货/上架进度及付款记录；操作记录与上游物流详情未逐项对等', True, True, '/operations?view=purchase-orders')
    port(['erp/purchase/orders/components/table.vue'], 'purchase', '采购单列表/筛选/分页、状态与供应商/商品摘要、已实现的 ERP 操作入口；不呈现未接入的 1688 状态', True, True, '/operations?view=purchase-orders')
    port(['erp/shipv2/shipment_handing/list/index.vue', 'erp/shipv2/shipment_handing/list/components/table.vue'], 'amazon-fulfillment', '按 Amazon 入库计划→货件→商品逐层浏览真实已发布观察记录，保留站点/版本/计划与货件筛选、业务字段详情和分页；未移植上游全部状态 Tab、货件写操作及未接入的高级筛选', True, False, '/operations?view=fulfillment')
    port(['erp/shipv2/shipment_handing/list/components/header.vue'], 'amazon-fulfillment', '搜索与筛选工具栏适配：店铺/站点、来源版本、ASIN/SKU、计划 ID/货件 ID、刷新与清除；物流商、渠道/运输方式、打印/海关 XML/导入追踪号/同步写操作未接入', True, False, '/operations?view=fulfillment')
    port(['erp/ship/shipment_handing/list/components/transinfo.vue'], 'fba', '运输单据描述分区和物流节点明细抽屉，展示 ERP 人工记录与来源凭据', True, False, '/operations?view=first-mile')
    port(['erp/ship/ship_plan/index.vue', 'erp/shipv2/shipment_add/shipstep/two_box.vue'], 'fba', '本地计划列表→详情→箱规保存，适配 ERP revision 与权限', True, True)
    port(['erp/shipv2/shipment_handing/shipstep/index_tab.vue'], 'fba', '货件详情工作流分区映射到本地计划、公司仓交接、人工头程轨迹、报关资料与货代费用；ERP 保留实际审批/操作，不把 Amazon 标签、物流状态或接收数量标为已接入', True, True, '/operations?view=first-mile')
    port(['erp/shipv2/shipment_handing/shipstep/components/three_deliver.vue'], 'fba', '运输表单改用 ERP 本地货代委托与人工物流节点服务；未移植上游承运商系统集成、重量/体积自动计费、运费公式及历史版本', True, True, '/operations?view=first-mile')
    port(['erp/shipv2/shipment_handing/shipstep/components/customs_picking.vue', 'erp/shipv2/shipment_handing/shipstep/components/customs_declaration.vue'], 'fba', '报关表单/明细适配 ERP 报关草稿、明细、内部复核、清关事件与内部 XML；上游税率/材质/关税计价、海关模板与真实关务接口未接入', True, True, '/operations?view=first-mile')
    port(['erp/shipv2/shipment_handing/shipstep/components/customs_clearance.vue'], 'fba', '清关资料操作改为 ERP 人工清关回执事件及复核状态；未接入上游发票模板上传/下载、国家计价比例或真实海关回执', True, True, '/operations?view=first-mile')
    port(['erp/finance/paymentRequest/index.vue', 'erp/finance/paymentRequest/components/table.vue'], 'expense', '五个状态 Tab、筛选区域及请款列；未接入提示', False, False)
    ui_verified = {source for source in ledger if any(part in source for part in [
        'erp/warehouse/transfer/', 'supplier/supplier_dialog.vue', 'orders/components/receipt.vue',
        'orders/components/pay_record.vue', 'shipv2/shipment_handing/list/components/table.vue',
        'ship/shipment_handing/list/components/transinfo.vue'])}
    ui_verified.update('src/views/'+p for p in [
        'erp/purchase/orders/components/arrival_record.vue',
        'erp/purchase/orders/components/skuTable.vue',
        'erp/purchase/orders/components/create.vue',
        'erp/purchase/orders/components/details.vue',
        'erp/purchase/orders/components/table.vue',
        'erp/warehouse/inbound/components/details.vue',
        'erp/warehouse/inbound/components/table.vue',
        'erp/warehouse/inbound/components/create.vue',
        'erp/warehouse/base/index.vue',
    ])
    ui_verified.update('src/views/'+p for p in [
        'erp/baseinfo/material/index.vue',
        'erp/baseinfo/material/components/header.vue',
        'erp/baseinfo/material/details/index.vue',
        'erp/baseinfo/material/details/components/listinfo.vue',
        'erp/baseinfo/material/editinfo/index.vue',
        'erp/baseinfo/material/editinfo/components/base.vue',
        'erp/baseinfo/material/editinfo/components/purchase.vue',
        'erp/baseinfo/material/editinfo/components/specs.vue',
        'erp/baseinfo/material/photoupload/index.vue',
        'erp/baseinfo/material/components/record.vue',
        'erp/baseinfo/material/editinfo/components/purchase_price_dialog.vue',
        'amazon/payment/settlement_sku/index.vue',
        'amazon/payment/settlement_sku/table.vue',
        'amazon/payment/settlement_sku/skutable.vue',
        'amazon/payment/settlement_sku/settlement.vue',
        'amazon/report/reimbursements_fee/index.vue',
        'amazon/order/order_manager/index.vue',
        'amazon/order/order_manager/components/table.vue',
        'amazon/order/order_manager/components/order_detail.vue',
    ])
    ui_verified.update('src/views/'+p for p in [
        'erp/shipv2/shipment_handing/list/index.vue',
        'erp/shipv2/shipment_handing/list/components/table.vue',
        'erp/warehouse/outbound/index.vue',
        'erp/warehouse/outbound/components/table.vue',
        'erp/warehouse/outbound/components/create.vue',
        'erp/warehouse/outbound/components/create_dialog.vue',
        'erp/warehouse/outbound/components/details.vue',
        'erp/warehouse/stocktake/index.vue',
        'erp/warehouse/stocktake/components/table.vue',
        'erp/warehouse/stocktake/components/create.vue',
        'erp/warehouse/stocktake/components/details.vue',
        'erp/warehouse/stocktake/components/sku_inventory.vue',
    ])
    isolated_db_verified = set()

    roles = {'index': '主视图', 'table': '数据表格', 'header': '搜索与操作栏', 'details': '详情', 'detail': '详情', 'create': '新建表单', 'edit': '编辑表单', 'list': '列表', 'payment': '付款', 'receipt': '收货', 'parentlist': '仓库列表', 'childrenlist': '子仓库列表', 'two_box': '装箱步骤', 'order_detail': '订单详情', 'skutable': 'SKU 表格'}
    rows = []
    for p in pages:
        source, text = p['source'], texts[p['source']]
        template = re.search(r'<template[^>]*>([\s\S]*)</template>', text)
        body = re.sub(r'<!--[\s\S]*?-->', '', template.group(1) if template else '')
        empty = not re.sub(r'</?(?:div|template)\b[^>]*>|\s+', '', body) and not re.search(r'\bv-|[:@]|\{\{', body)
        candidate = not routes[source] and not reverse[source] and p['kind'] == 'entry_candidate' and not empty
        if empty:
            kind, reason = '空模板', '去除注释和空容器后没有模板内容'
        elif routes[source]:
            kind, reason = '独立页面', '静态路由直接引用（包括 components 目录内的路由页面）'
        elif re.match(r'\s*<el-(?:dialog|drawer)\b', body) or re.search(r'(?:dialog|dailog)\.vue$', source, re.I):
            kind, reason = '弹窗', '模板以 dialog/drawer 开始或文件明确以 dialog/dailog 命名（静态判定）'
        elif source.startswith('src/views/erp/components/') or len({posixpath.dirname(x) for x in reverse[source]}) > 2:
            kind, reason = '公共组件', '共享目录或被三个以上不同目录引用（静态判定）'
        elif candidate:
            kind, reason = '独立页面', '未被静态导入的 index/fbacenter 候选；动态菜单尚未确认'
        else:
            kind, reason = '子组件', '非直接路由；仅静态组件角色，可能有未解析动态入口'
        name = re.search(r'''\bname\s*:\s*['"]([^'"]*[\u4e00-\u9fff][^'"]*)['"]''', text)
        chinese = name.group(1) if name else p['module']+' · '+roles.get(Path(source).stem, '视图组件')+'（'+Path(source).stem+'）'
        entry = ledger.get(source)
        excluded = 'OUT_OF_GENERIC_SCOPE' in p['status'] or empty
        # Stage applies to the explicitly recorded adaptation scope, never upstream parity.
        stage = '明确不移植及原因' if excluded else '已接入真实业务操作' if entry and entry['operation'] else '已接入真实 ERP 数据' if entry and entry['data'] else '已完成 UI 移植' if entry else '已分析'
        cap = capabilities[entry['capability']] if entry else None
        candidate_cap = next((key for key, value in capabilities.items() if value['route']==p['erpCandidate']), None)
        actions = []
        for match in re.finditer(r'<el-(?:button|link)\b([^>]*)>([\s\S]*?)</el-(?:button|link)>', body):
            label = re.sub(r'<[^>]+>', '', match.group(2)).strip()
            if label and len(label)<100:
                actions.append({'label': label, 'line': text[:template.start(1)+match.start()].count('\n')+1,
                                'attributes': match.group(1).strip()})
        upstream_apis = [{'literal': literal, 'line': line} for literal, line in imports(text) if '/api/' in literal]
        missing = list(cap['remaining']) if cap else [p.get('reviewNote') or '仅完成源码静态分析和候选映射；尚未逐项移植至 React，未验证字段/交互对等']
        if excluded:
            missing = ['空模板无业务内容，不新增空入口' if empty else p['reviewNote']]
        row = {'source': source, 'sha256': p['sha256'], 'businessNameZh': chinese,
               'businessNameEvidence': '源码 name 字段' if name else '模块及文件角色推导，尚非已核验菜单标题',
               'module': p['module'], 'pageType': kind, 'classificationEvidence': reason,
               'standaloneConfirmed': bool(routes[source]) and not empty, 'dynamicEntryCandidate': candidate,
               'sourceRoutes': routes[source],
               'sourceMenu': {'path': None, 'status': '未核验', 'reason': '由 /api/admin/api/v1/menus/route 下发；没有授权菜单响应，静态路由不等于菜单项', 'evidence': 'src/router/index.js'},
               'vueDependencies': deps[source], 'importedBy': sorted(set(reverse[source])),
               'sourceApiImports': upstream_apis, 'sourceActionEvidence': actions,
               'navigationEvidence': p['navigationLiterals'], 'layoutEvidence': p['layout'],
               'erp': {'candidateRoute': p['erpCandidate'], 'actualRoute': (entry.get('route') or cap['route']) if entry else None,
                       'capability': entry['capability'] if entry else None, 'reactComponents': cap['reactComponents'] if cap else [],
                       'apiFiles': cap['apiFiles'] if cap else [], 'services': cap['services'] if cap else [],
                       'apiEndpoints': ['/'+x.removeprefix('src/app/').removesuffix('/route.ts') for x in cap['apiFiles']] if cap else [],
                       'candidateCapability': candidate_cap,
                       'candidateReactComponents': capabilities[candidate_cap]['reactComponents'] if candidate_cap else [],
                       'candidateApiFiles': capabilities[candidate_cap]['apiFiles'] if candidate_cap else [],
                       'candidateServices': capabilities[candidate_cap]['services'] if candidate_cap else [],
                       'unresolvedMappingReason': None if entry else '尚未建立该文件的实际 React/API/Service 对应；候选页面及服务不算移植完成',
                       'mappingStatus': '已有适配（范围有限）' if entry else '明确不移植' if excluded else '仅候选/暂无等价映射'},
               'migrationStatus': stage, 'implementedScope': entry['implementedScope'] if entry else None,
               'scopeParity': '部分适配，不承诺上游全部功能对等' if entry else '不适用' if excluded else '未移植',
               'stages': {'uiAdapted': bool(entry), 'realErpDataWired': bool(entry and entry['data']),
                          'realErpOperationWired': bool(entry and entry['operation']), 'isolatedTestVerifiedThisRun': source in isolated_db_verified,
                          'isolatedUiFixtureVerified': source in ui_verified,
                          'accepted': False, 'fullSourceParityVerified': False},
               'verification': {'thisRun': '隔离 Next/Chromium + 临时 PostgreSQL 页面流验证已通过（仅上述适配范围）；不是生产验收' if source in isolated_db_verified else '隔离 HTTP fixture 浏览器验证已通过（仅上述适配范围）；不是实际数据库或生产验收' if source in ui_verified else '源文件/路由哈希、静态依赖与 ERP 文件引用检查；未逐文件运行页面或业务操作',
                                'currentEvidence': ['docs/wimoor-integration/ui/2026-11-12/delivery.md'] if source in ui_verified or source in isolated_db_verified else [],
                                'historicalEvidence': ['docs/wimoor-integration/ui/2026-11-12/delivery.md'] if entry else [],
                                'historicalEvidenceScope': '历史模块级 fixture/临时库记录；不自动证明本文件全部功能、当前代码或生产验收' if entry else None},
               'remainingFeatures': missing, 'analysisLimits': ['依赖仅解析静态 import/from；全局自动注册、运行时变量 import 和运行时菜单未穷尽', '已分析表示静态资产分析，不表示逐项业务语义验收']}
        rows.append(row)

    counts = {'totalFiles': len(rows), 'pageTypes': dict(Counter(r['pageType'] for r in rows)),
              'standaloneConfirmed': sum(r['standaloneConfirmed'] for r in rows),
              'standaloneBusinessConfirmed': sum(r['standaloneConfirmed'] and r['module']!='系统' for r in rows),
              'standaloneDynamicCandidates': sum(r['dynamicEntryCandidate'] and r['pageType']=='独立页面' for r in rows),
              'migrationStatuses': dict(Counter(r['migrationStatus'] for r in rows)),
              'uiAdaptedFiles': sum(r['stages']['uiAdapted'] for r in rows),
              'realDataWiredFiles': sum(r['stages']['realErpDataWired'] for r in rows),
              'realOperationWiredFiles': sum(r['stages']['realErpOperationWired'] for r in rows),
              'notAdaptedFiles': sum(not r['stages']['uiAdapted'] and r['migrationStatus']!='明确不移植及原因' for r in rows),
              'explicitlyExcludedFiles': sum(r['migrationStatus']=='明确不移植及原因' for r in rows),
              'fullSourceParityVerifiedFiles': 0, 'isolatedUiFixtureVerifiedFiles': len(ui_verified), 'isolatedTestVerifiedThisRunFiles': len(isolated_db_verified), 'acceptedFiles': 0}
    result = {'schemaVersion': 1, 'snapshotDate': '2026-11-12', 'sourceHead': original['head'],
              'scope': '固定 source-inventory.json 中 src/views 下的 729 个 Vue 文件；不包含 src/layout 等其他 Vue 资产',
              'preservedEvidence': preserved, 'statusVocabulary': STATES,
              'statusPolicy': '状态仅对应 implementedScope。数据/操作接入表示真实 ERP 服务调用链已存在，不表示真实环境执行成功；部分适配和完整文件对等分别统计。隔离测试/验收不得从历史目录级记录推升。',
              'countPolicy': '统计单位是唯一 Vue 文件，不是 React 组件数/菜单数。UI/data/operation 数是显式适配范围内的累计数；独立页面确认值仅含静态路由，动态候选另列。',
              'counts': counts, 'capabilities': capabilities, 'pages': rows}
    (OUT/'wimoor-page-migration-matrix.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    lines = ['# Wimoor 729 文件移植追踪矩阵', '',
             '基于现有固定清单补充分析，原清单与哈希未覆盖。完整字段、依赖、路由行号、API/Service 路径、缺口和验证见 [JSON](wimoor-page-migration-matrix.json)。', '',
             '> 状态只适用于逐行声明的适配范围，不能代表整个源文件功能对等。真实数据/操作“接入”是代码连接，未执行真实环境操作。历史测试不升级当前隔离测试或验收状态。候选 ERP 路由不是已移植证据。', '',
             '## 数量口径', '', '```json', json.dumps(counts, ensure_ascii=False, indent=2), '```', '',
             '独立页面分静态确认和动态候选；没有服务端菜单响应，无法宣称完整独立业务页面总数。当前类型是静态分类，JSON 保留每项依据和限制。', '',
             '## 全部文件', '', '| # | 原始文件（哈希见 JSON） | 中文业务名称 / 模块 | 类型 / 入口证据 | ERP 实际映射（候选不计完成） | 状态 | 尚未实现 / 验证 |', '| --- | --- | --- | --- | --- | --- | --- |']
    for i, r in enumerate(rows, 1):
        route = ', '.join(x['path'] for x in r['sourceRoutes']) or ('动态菜单候选，未确认' if r['dynamicEntryCandidate'] else '无静态路由')
        erp = r['erp']['actualRoute'] or ('候选：'+r['erp']['candidateRoute'] if r['erp']['candidateRoute'] else '无等价映射')
        values = [str(i), '`'+r['source']+'`', r['businessNameZh']+' / '+r['module'], r['pageType']+' / '+route, erp, r['migrationStatus']+('（仅：'+r['implementedScope']+'）' if r['implementedScope'] else ''), '；'.join(r['remainingFeatures'])+'；'+('适配范围 UI fixture 通过；数据库链未验收' if r['stages']['isolatedUiFixtureVerified'] else '本轮未逐文件运行验收')]
        lines.append('| '+' | '.join(v.replace('|','\\|').replace('\n',' ') for v in values)+' |')
    (OUT/'wimoor-page-migration-matrix.md').write_text('\n'.join(lines)+'\n')
    next_batch = [
        ('erp/purchase/orders/components/sku_table_inner_dailog.vue', '采购明细内层对话框', 'purchase', '只移植已存在 ERP 收货/采购动作；拒绝上游库存逆向或不支持的实物回滚'),
        ('erp/purchase/orders/components/change_records.vue', '采购变更记录弹窗', 'purchase', '检查是否有不可变采购审计数据；无等价事实源前仅记录缺口，不伪造历史'),
        ('erp/warehouse/inbound/components/create_dialog.vue', '采购/库存商品选择弹窗', 'wms', 'ERP 表单按已建批次收货，不在无统一可用库存和采购成本接口时补造上游列'),
    ]
    gaps = ['# Wimoor 移植缺口与下一批页面', '', '本文件由固定 729 项矩阵生成；不是新开发完成报告。', '',
            '## 关键缺口', '',
            '- 菜单证据：动态菜单由 Wimoor 服务端提供；729 项均记录未核验菜单，不根据文件夹虚构菜单名称或路由。',
            '- 全量对等：当前仅显式适配文件进入接入统计，其余候选路由不算完成；全部 729 项均未宣称完整源文件功能对等或用户验收。',
            '- Amazon 入库：本地计划/装箱与外部快照不等于 Amazon 创建计划、确认装箱、购买标签和发货写入。',
            '- FBA 货件列表：Wimoor shipv2 货件列表/筛选/表格结构映射到 ERP `/operations?view=fulfillment` 已发布观察查询，保留计划→货件→商品下钻、来源版本、分页、筛选与 Amazon 状态标签；仅在获批计划范围内只读展示。上游阶段状态 Tab、高级物流筛选、写操作和实际接收数量均不在现有 API/快照范围内，保持未接入。',
            '- FBA 运输/报关：Wimoor 运输与报关布局复用现有本地 FBA 工作台的货代委托、人工轨迹、报关草稿、复核和清关节点服务；不是承运商 API、海关直连或 Amazon 履约操作。税率/产品材质/费用公式、发票模板、重量体积计费历史仍缺失。',
            '- 财务：交易查询不等于总账、凭证、关账；通用请款/报销/核销缺少 API、Service 与模型。采购付款退款和 FBA 费用沿独立服务。',
            '- 地址、VAT、Transparency、利润方案、可编辑 FBA 费用公式、第三方物流凭证等，现有相关入口不能替代独立业务生命周期。',
            '- 调拨：状态筛选、单据表格、详情和草稿明细布局已适配；UI fixture 已通过。打印、导入及完整审计时间线未移植。',
            '- WMS 收货/出库/盘点：本批补齐收货建档与详情、出库需求草稿列表/详情/产品选择、库位批次盘点列表/实盘输入；均沿用 ERP WMS 服务。隔离浏览器只验证组件/API 形状，不是数据库业务链验收；批量导入导出、直接库存回滚、海外仓盘点、打印等仍未移植。',
            '- 子组件：父页适配不代表打印、批量导入导出、专属弹窗和业务动作全部移植；请按每行 dependencies 与 remainingFeatures 继续推进。', '',
            '## 下一批可直接复用服务的文件', '', '| 原始文件 | 功能 | 现有服务/入口 | 实施边界 |', '| --- | --- | --- | --- |']
    for source, name, cap, boundary in next_batch:
        assert 'src/views/'+source in sources
        gaps.append('| `src/views/'+source+'` | '+name+' | '+capabilities[cap]['route']+'；`'+capabilities[cap]['services'][0]+'` | '+boundary+' |')
    gaps += ['', '## 验证与复跑', '', '`python3 scripts/wimoor/build-migration-matrix.py` 仅读取固定清单列出的源文件和路由；源哈希不一致即失败，不修改原清单。验证 729 个唯一键、路由组件对应、依赖路径、ERP 引用存在、状态与统计不变量，以及原 JSON/Markdown 字节哈希保持不变。', '',
             '继续移植已修改 UI 并运行隔离浏览器测试；本轮范围与结果见 [delivery.md](delivery.md) 的最新“FBA 货件与运输/报关结构续接”小节。此前临时数据库集成在既有 `20261130010000_finance_ledger` 脚本处因 PostgreSQL 同参数函数 `finance_voucher_line_guard` 重复声明而失败，未进入新增页面验证；未修改该并行迁移，也未操作真实业务数据库或 Amazon。', '',
             '本批新增/修改文件及测试结果见 [delivery.md](delivery.md)。未提交、未推送、未部署。']
    (OUT/'wimoor-page-migration-gaps.md').write_text('\n'.join(gaps)+'\n')
    assert all(digest(ROOT/p)==sha for p, sha in preserved.items())
    assert counts['uiAdaptedFiles']+counts['notAdaptedFiles']+counts['explicitlyExcludedFiles']==729
    assert counts['realOperationWiredFiles'] <= counts['realDataWiredFiles'] <= counts['uiAdaptedFiles']
    assert all(r['migrationStatus'] in STATES for r in rows)
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Read-only Wimoor Vue inventory; lexical evidence is not runtime menu evidence."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

RULES = [
    ('erp/baseinfo/material/', '商品 / SKU', '/dashboard'),
    ('amazon/listing/', 'Amazon Listing', '/operations?view=listing_details'),
    ('amazon/storeAuth/', '账号 / 站点', '/operations?view=connections'),
    ('amazon/order/', '订单', '/operations?view=orders'),
    ('erp/warehouse/base/', '仓库档案', '/logistics/warehouse?tab=warehouses'),
    ('erp/warehouse/inbound/', '入库', '/logistics/warehouse?tab=receipts'),
    ('erp/warehouse/outbound/', '出库', '/logistics/warehouse?tab=reservations'),
    ('erp/warehouse/transfer/', '调拨', '/logistics/warehouse?tab=balances'),
    ('erp/warehouse/', '公司仓库存', '/logistics/warehouse?tab=balances'),
    ('amazon/inventory/', 'FBA 库存', '/operations?view=inventory'),
    ('erp/purchase/', '采购', '/operations?view=purchase-orders'),
    ('erp/baseinfo/supplier/', '供应商', '/operations?view=suppliers'),
    ('erp/shipv2/shipment_add/shipstep/two_box', 'FBA 装箱', '/operations?view=fba-boxing'),
    ('erp/ship/transportation/', '头程物流', '/operations?view=first-mile'),
    ('erp/ship/quota/', '物流报价', '/operations?view=first-mile'),
    ('erp/ship', 'FBA 物流', '/operations?view=fulfillment'),
    ('amazon/inbound/', 'FBA 入库计划', '/operations?view=fulfillment'),
    ('erp/finance/paymentRequest/', '费用 / 请款', '/operations?view=expense-management'),
    ('erp/finance/', 'ERP 财务', '/operations?view=finance'),
    ('amazon/payment/settlement_sku/', 'Amazon 结算', '/operations?view=settlements'),
    ('amazon/payment/', 'Amazon 财务', '/operations?view=finance'),
    ('finance/', '总账 / 凭证 / 财务', '/operations?view=finance'),
    ('amazon/advertisement/', '广告', '/amazon-ads/campaigns'),
    ('amazon/report/', '报告', '/operations?view=sales-traffic'),
    ('dashboard/', '数据看板', '/operations?view=sales-traffic'),
    ('sys/', '系统', '/settings'),
]

MANUAL_RULES = [
    ('amazon/inbound/fbacenter.vue', 'FBA 配送中心地址维护', None, 'MANUALLY_REVIEWED_NO_EQUIVALENT', '实际模板维护 Code、国家、地址名称、城市、州区、邮编和区域，不是入库计划；ERP 当前没有等价配送中心地址簿。'),
    ('amazon/address/', 'Amazon 发货地址', None, 'MANUALLY_REVIEWED_NO_EQUIVALENT', 'Wimoor 管理 Seller 发货地址及启停；ERP 当前没有同一地址簿和相应模型/API。'),
    ('amazon/profit/calculator/', 'Amazon 利润测算', '/operations?view=finance', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 是按 SKU/ASIN 输入成本、尺寸、重量和费用方案的单品测算；ERP 财务页读 Amazon 交易，不等同测算器。'),
    ('amazon/profit/config/', 'Amazon 利润方案配置', None, 'MANUALLY_REVIEWED_NO_EQUIVALENT', 'Wimoor 保存利润计算方案并设置店铺默认方案；ERP 尚无相同配置模型/API。'),
    ('amazon/profit/fbafee/', 'Amazon FBA 费用公式', '/operations?view=finance', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 配置尺寸段、佣金和仓储费公式；ERP 财务交易不能替代可编辑费用公式。'),
    ('amazon/sales/details/', 'Amazon 销量明细', '/operations?view=sales-traffic', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 按日/周/月、销量/订单聚合商品表现；ERP 销售与流量报表按现有报表契约展示，字段和分组不保证等价。'),
    ('amazon/sales/forecast/', 'Amazon 销量预测', '/operations?view=replenishment', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 结合上架日期、销量预测和库存规划；ERP 补货建议有独立数据来源与口径，不等同该预测工作台。'),
    ('amazon/sales/report/', 'Amazon 销售报表', '/operations?view=sales-traffic', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 提供日/周/月销售统计与列配置；ERP 报表复用服务端销售流量查询，但未承诺列配置等价。'),
    ('amazon/service/VatInvioce/', 'Amazon VAT 发票', None, 'MANUALLY_REVIEWED_NO_EQUIVALENT', 'Wimoor 按订单、SKU、店铺和国家管理 VAT 发票；ERP 当前无相同税务发票模块/API。'),
    ('amazon/transparency/', 'Amazon Transparency', None, 'MANUALLY_REVIEWED_NO_EQUIVALENT', 'Wimoor 包含 Transparency 授权、产品和 T-code 任务；ERP 当前没有相同认证码域。'),
    ('customized/amazon_follow_ui/', '客户定制跟卖与调价', '/operations?view=pricing', 'MANUALLY_REVIEWED_RELATED_ONLY', '该定制页含跟卖监控、调价和记录；ERP 价格视图不自动意味着相同跟卖策略或执行能力。'),
    ('customized/chelsea/', 'Chelsea 客户定制工作区', None, 'MANUALLY_REVIEWED_OUT_OF_GENERIC_SCOPE', '该目录是客户专属电子电器、库存、采购计划、订单和利润页面，不属于通用 Wimoor ERP 页面；不移植为通用菜单。'),
    ('erp/baseinfo/brand/', '商品品牌档案', '/dashboard', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 品牌列表含搜索、增改删；ERP 商品主档可关联品牌语义，但需以 ProductRecord 当前字段/API 为准，不能推定独立品牌档案等价。'),
    ('erp/baseinfo/category/', '商品品类档案', '/dashboard', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 品类列表含搜索、增改删；ERP 商品主档/分类字段不等同该独立档案 CRUD。'),
    ('erp/baseinfo/quote/', '供应商报价单', '/operations?view=purchase-orders', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 展示报价单及明细；ERP 采购订单和供应商档案不含报价单生命周期。'),
    ('erp/components/', 'ERP 共享界面组件', None, 'MANUALLY_REVIEWED_SHARED_COMPONENT', '该目录包含组装、下载和货架库存操作组件，不是独立路由或菜单页面。'),
    ('erp/thirdparty/', '物流商与海外仓 API 配置', '/logistics', 'MANUALLY_REVIEWED_RELATED_ONLY', 'Wimoor 配置第三方物流/海外仓授权；ERP Logistics 文件工作台不承载凭证或连接管理。'),
]

def extract(root):
    ui = root / 'wimoor-ui/src'
    pages = []
    for file in sorted((ui / 'views').rglob('*.vue')):
        source = file.read_text(errors='replace')
        relative = file.relative_to(ui / 'views').as_posix()
        manual = next((rule for rule in MANUAL_RULES if relative.startswith(rule[0])), None)
        match = next((rule for rule in RULES if relative.startswith(rule[0])), None) if manual is None else None
        def evidence(pattern):
            return [{'line': source[:m.start()].count('\n') + 1, 'value': m.group(1)} for m in re.finditer(pattern, source)][:100]
        pages.append({
            'source': 'src/views/' + relative,
            'sha256': hashlib.sha256(source.encode()).hexdigest(),
            'kind': 'entry_candidate' if file.name in ['index.vue', 'fbacenter.vue'] else 'component_or_auxiliary',
            'module': match[1] if match else manual[1] if manual else '待人工归类',
            'erpCandidate': match[2] if match else manual[2] if manual else None,
            'status': manual[3] if manual else 'LEXICAL_INVENTORY_NOT_MANUAL_ACCEPTANCE' if match else 'NEEDS_MANUAL_CLASSIFICATION',
            'reviewNote': manual[4] if manual else None,
            'labels': evidence(r'(?:label|title)\s*=\s*[\x22\x27]([^\x22\x27\n]{1,100})[\x22\x27]'),
            'localComponents': evidence(r'from\s+[\x22\x27](\.[^\x22\x27]+)[\x22\x27]'),
            'navigationLiterals': evidence(r'(?:path|name)\s*:\s*[\x22\x27]([^\x22\x27\n]+)[\x22\x27]'),
            'layout': {token: len(re.findall(r'<'+token+r'(?:\s|>)', source, re.I)) for token in ['el-table', 'el-table-column', 'GlobalTable', 'el-form', 'el-dialog', 'el-drawer', 'el-tabs', 'el-button', 'el-pagination']},
        })
    routes = []
    for file in sorted((ui / 'router').rglob('*.js')):
        source = file.read_text(errors='replace')
        routes.append({'source': file.relative_to(root / 'wimoor-ui').as_posix(), 'sha256': hashlib.sha256(source.encode()).hexdigest(),
                       'paths': re.findall(r'\bpath\s*:\s*[\x22\x27]([^\x22\x27]+)[\x22\x27]', source),
                       'components': re.findall(r'import\([\x22\x27]([^\x22\x27]+)[\x22\x27]\)', source)})
    return {'sourceRoot': str(root), 'head': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
            'notes': ['Static source evidence only; dynamic menu hierarchy and permissions require an authorized server response.', 'ERP candidates share existing pages and do not claim feature parity.', 'No upstream code or third-party image/icon is copied. Layout adaptations carry MIT notice separately.'],
            'vueFiles': len(pages), 'pages': pages, 'routers': routes}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    payload = extract(args.source)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'source-inventory.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Wimoor Vue 源码清单', '', f"{payload['vueFiles']} 个 Vue 文件均按路径清单记录；人工归类或语义复核 {sum(page['status'].startswith('MANUALLY_REVIEWED_') for page in payload['pages'])} 个。子组件继承父页面族，不代表每个子组件均单独运行验收。其余为词法候选，动态菜单由服务端下发。", '', '| 源文件 | 类型 | 模块候选 | ERP 共用入口 |', '| --- | --- | --- | --- |']
    for page in payload['pages']:
        lines.append('| \x60' + page['source'] + '\x60 | ' + page['kind'] + ' | ' + page['module'] + ' | ' + (page['erpCandidate'] or '未映射，未新增入口') + ' |')
    (args.output / 'page-inventory.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'vueFiles': payload['vueFiles'], 'routerFiles': len(payload['routers']), 'mappedCandidates': sum(bool(page['erpCandidate']) for page in payload['pages']), 'manuallyReviewed': sum(page['status'].startswith('MANUALLY_REVIEWED_') for page in payload['pages']), 'unclassified': sum(page['status'] == 'NEEDS_MANUAL_CLASSIFICATION' for page in payload['pages'])}, ensure_ascii=False))

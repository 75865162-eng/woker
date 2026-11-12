# Wimoor Vue 源码清单

729 个 Vue 文件均按路径清单记录；人工归类或语义复核 85 个。子组件继承父页面族，不代表每个子组件均单独运行验收。其余为词法候选，动态菜单由服务端下发。

| 源文件 | 类型 | 模块候选 | ERP 共用入口 |
| --- | --- | --- | --- |
| `src/views/amazon/address/components/editdialog.vue` | component_or_auxiliary | Amazon 发货地址 | 未映射，未新增入口 |
| `src/views/amazon/address/components/table.vue` | component_or_auxiliary | Amazon 发货地址 | 未映射，未新增入口 |
| `src/views/amazon/address/index.vue` | entry_candidate | Amazon 发货地址 | 未映射，未新增入口 |
| `src/views/amazon/advertisement/download/index.vue` | entry_candidate | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/ad_chart.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/ad_order_cycle.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/ad_tree.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/data_filter.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/date_select.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/portfolios_plane.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/common/schedule_plan.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/adcreative.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/bidding.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/bidding_dialog.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/bidding_tactics_sb.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/bidding_tactics_sp.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/bidding_type.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/negative_keywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/negative_target.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/product_add.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/target.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/target_keyword.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/components/target_product.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/create.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listAdgroups.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listCampNegativaKeywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listCampNegativaTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listCampaigns.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listKeywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listKeywordsQuery.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listNegativaKeywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listNegativaTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listProductAds.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listPurchaseProductAds.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/hsa/listTargetQuery.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/adcreative.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/bidding.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/bidding_dialog.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/bidding_tactics_sp.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/bidding_type.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/negative_keywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/negative_target.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/product_add.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/target.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/components/target_product.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/create.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/listAdgroups.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/listCampaigns.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/listNegativaTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/listProductAds.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/listPurchaseProductAds.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sd/listTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/bidding.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/bidding_dialog.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/bidding_tactics_sp.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/bidding_type.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/negative_keywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/negative_target.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/product_add.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/target.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/target_keyword.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/components/target_product.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/create.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listAdgroups.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listCampNegativaKeywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listCampNegativaTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listCampaigns.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listKeywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listKeywordsQuery.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listNegativaKeywords.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listNegativaTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listProductAds.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listPurchaseProductAds.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listTarget.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/components/sp/listTargetQuery.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/index.vue` | entry_candidate | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/warn/components/create.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/manager/warn/index.vue` | entry_candidate | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/operation_record/components/detail.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/operation_record/components/remarks_dialog.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/operation_record/index.vue` | entry_candidate | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/overview/components/adFunnel.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/overview/components/adStatistics.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/overview/components/indicator.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/overview/components/indicator_detail.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/overview/components/roasRank.vue` | component_or_auxiliary | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/overview/index.vue` | entry_candidate | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/advertisement/rules/index.vue` | entry_candidate | 广告 | /amazon-ads/campaigns |
| `src/views/amazon/inbound/fbacenter.vue` | entry_candidate | FBA 配送中心地址维护 | 未映射，未新增入口 |
| `src/views/amazon/inventory/fba/daily.vue` | component_or_auxiliary | FBA 库存 | /operations?view=inventory |
| `src/views/amazon/inventory/fba/detail.vue` | component_or_auxiliary | FBA 库存 | /operations?view=inventory |
| `src/views/amazon/inventory/planning/index.vue` | entry_candidate | FBA 库存 | /operations?view=inventory |
| `src/views/amazon/inventory/quantity/index.vue` | entry_candidate | FBA 库存 | /operations?view=inventory |
| `src/views/amazon/inventory/worth/index.vue` | entry_candidate | FBA 库存 | /operations?view=inventory |
| `src/views/amazon/listing/analysis/components/data_deatils.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/analysis/components/dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/analysis/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/catalog/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/common/arrival_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/common/goods_deatils.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/common/group.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/common/group_only.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/common/listings.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/common/salechart.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/price_adjust/components/table.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/price_adjust/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/arrival_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/batchmodifypriceDialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/follow_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/matching.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/modifypriceDialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/profit_details.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/prostatus.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/refreshProduct.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/remarks_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/sale_formula.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/sale_status_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/sale_status_select.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/components/table.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_customs/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_edit/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_label/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/product_plus/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/arrival_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/batchmodifypriceDialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/fbainvhistory_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/feedback_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/follow_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/matching.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/modifypriceDialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/productAIDialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/profit_details.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/prostatus.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/refreshProduct.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/remarks_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/sale_formula.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/sale_status_dialog.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/sale_status_select.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/components/table.vue` | component_or_auxiliary | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/products/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/listing/relation_msku/index.vue` | entry_candidate | Amazon Listing | /operations?view=listing_details |
| `src/views/amazon/order/fbm/components/header.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/components/invoice.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/components/invoice_template.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/components/invoice_view.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/components/invoice_view_refund.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/components/order_detail.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/components/table.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/fbm/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/order/fulfillment/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/header.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/invoice.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/invoice_template.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/invoice_view.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/invoice_view_refund.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/message.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/order_detail.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/components/table.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/order_manager/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/header.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/skudetail.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/summary_chart.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/summary_chart_line.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/summary_chart_pie.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/summary_sku.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/components/table.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/refund/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/order/remove/components/header.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/remove/components/table.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/remove/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/order/summary_week_month/components/day.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/summary_week_month/components/header.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/summary_week_month/components/month.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/summary_week_month/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/order/today/components/header.vue` | component_or_auxiliary | 订单 | /operations?view=orders |
| `src/views/amazon/order/today/index.vue` | entry_candidate | 订单 | /operations?view=orders |
| `src/views/amazon/payment/common/refresh_data_dialog.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/costSharing/components/create.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/costSharing/components/otherFee.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/costSharing/components/shareRules.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/costSharing/components/table.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/costSharing/cost_dialog.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/costSharing/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/finance/components/month.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/finance/components/other_fee_dialog.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/finance/components/record.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/finance/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/item_fee/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/jobCosting/components/edit.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/jobCosting/components/resetAddDialog.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/jobCosting/components/table.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/jobCosting/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/monthReport/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/performanpce/components/monthReport.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/performanpce/components/table.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/performanpce/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/components/accCalc_dialog.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/components/formula.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/profitGroup/components/profitGroup.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/profitGroup/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/table/child.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/profitReport/table/table.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/record/detail.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/record/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/record/records.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/record/report.vue` | component_or_auxiliary | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/payment/settlement_sku/account_dialog.vue` | component_or_auxiliary | Amazon 结算 | /operations?view=settlements |
| `src/views/amazon/payment/settlement_sku/index.vue` | entry_candidate | Amazon 结算 | /operations?view=settlements |
| `src/views/amazon/payment/settlement_sku/settlement.vue` | component_or_auxiliary | Amazon 结算 | /operations?view=settlements |
| `src/views/amazon/payment/settlement_sku/skutable.vue` | component_or_auxiliary | Amazon 结算 | /operations?view=settlements |
| `src/views/amazon/payment/settlement_sku/table.vue` | component_or_auxiliary | Amazon 结算 | /operations?view=settlements |
| `src/views/amazon/payment/summaryMonth/index.vue` | entry_candidate | Amazon 财务 | /operations?view=finance |
| `src/views/amazon/profit/calculator/components/country_collapse.vue` | component_or_auxiliary | Amazon 利润测算 | /operations?view=finance |
| `src/views/amazon/profit/calculator/components/fba_size.vue` | component_or_auxiliary | Amazon 利润测算 | /operations?view=finance |
| `src/views/amazon/profit/calculator/components/profit_deatils.vue` | component_or_auxiliary | Amazon 利润测算 | /operations?view=finance |
| `src/views/amazon/profit/calculator/index.vue` | entry_candidate | Amazon 利润测算 | /operations?view=finance |
| `src/views/amazon/profit/config/components/edit_plan.vue` | component_or_auxiliary | Amazon 利润方案配置 | 未映射，未新增入口 |
| `src/views/amazon/profit/config/components/market_fee/form.vue` | component_or_auxiliary | Amazon 利润方案配置 | 未映射，未新增入口 |
| `src/views/amazon/profit/config/index.vue` | entry_candidate | Amazon 利润方案配置 | 未映射，未新增入口 |
| `src/views/amazon/profit/fbafee/component/fba.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/fbasipp.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/inplace.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/inplacefee.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/referralfee.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/storagefee.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/tier.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/tierformat.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/component/tierweight.vue` | component_or_auxiliary | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/profit/fbafee/index.vue` | entry_candidate | Amazon FBA 费用公式 | /operations?view=finance |
| `src/views/amazon/report/fba_fee/header.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/fba_fee/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/open/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/pageview/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/coupon/header.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/coupon/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/orderfeedback/header.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/orderfeedback/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/promotions/header.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/promotions/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/seller/header.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/performance/seller/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/reimbursements_fee/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/detail/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/fee_summary/detail_dialog.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/fee_summary/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/fee_summary_new/detail_dialog.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/fee_summary_new/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/ship_fee_record/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/ship_summary/component/piechart.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/ship_summary/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/ship/time/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/shipv2/detail/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/shipv2/ship_summary/component/piechart.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/shipv2/ship_summary/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/storage_fee/index.vue` | entry_candidate | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/storage_fee/index_fee.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/report/storage_fee/index_long.vue` | component_or_auxiliary | 报告 | /operations?view=sales-traffic |
| `src/views/amazon/sales/details/index.vue` | entry_candidate | Amazon 销量明细 | /operations?view=sales-traffic |
| `src/views/amazon/sales/forecast/components/sale_adjust_dialog.vue` | component_or_auxiliary | Amazon 销量预测 | /operations?view=replenishment |
| `src/views/amazon/sales/forecast/components/sale_adjust_upload_dialog.vue` | component_or_auxiliary | Amazon 销量预测 | /operations?view=replenishment |
| `src/views/amazon/sales/forecast/index.vue` | entry_candidate | Amazon 销量预测 | /operations?view=replenishment |
| `src/views/amazon/sales/report/index.vue` | entry_candidate | Amazon 销售报表 | /operations?view=sales-traffic |
| `src/views/amazon/service/VatInvioce/index.vue` | entry_candidate | Amazon VAT 发票 | 未映射，未新增入口 |
| `src/views/amazon/storeAuth/advResult/index.vue` | entry_candidate | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/authResult/index.vue` | entry_candidate | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/components/advReport.vue` | component_or_auxiliary | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/components/authadv.vue` | component_or_auxiliary | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/components/authstore.vue` | component_or_auxiliary | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/components/table.vue` | component_or_auxiliary | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/components/taskData.vue` | component_or_auxiliary | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/storeAuth/index.vue` | entry_candidate | 账号 / 站点 | /operations?view=connections |
| `src/views/amazon/transparency/auth/index.vue` | entry_candidate | Amazon Transparency | 未映射，未新增入口 |
| `src/views/amazon/transparency/manager/components/skuinfo.vue` | component_or_auxiliary | Amazon Transparency | 未映射，未新增入口 |
| `src/views/amazon/transparency/manager/components/task.vue` | component_or_auxiliary | Amazon Transparency | 未映射，未新增入口 |
| `src/views/amazon/transparency/manager/components/tcode.vue` | component_or_auxiliary | Amazon Transparency | 未映射，未新增入口 |
| `src/views/amazon/transparency/manager/components/uploadDialog.vue` | component_or_auxiliary | Amazon Transparency | 未映射，未新增入口 |
| `src/views/amazon/transparency/manager/index.vue` | entry_candidate | Amazon Transparency | 未映射，未新增入口 |
| `src/views/customized/amazon_follow_ui/components/asinLog.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/batchEditDialog.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/batchFollow.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/downloadItem.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/followAdd.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/followEdit.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/followTime.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/header.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/components/warning.vue` | component_or_auxiliary | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/amazon_follow_ui/index.vue` | entry_candidate | 客户定制跟卖与调价 | /operations?view=pricing |
| `src/views/customized/chelsea/electronics/components/data_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/electronics/components/uploadSalesDialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/electronics/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/finance/components/month.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/finance/components/other_fee_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/finance/components/record.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/finance/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/forecast/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/inventory/components/history_inv.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/inventory/components/plan_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/inventory/components/sales_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/inventory/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/create.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/inv_header.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/inv_his_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/inv_table.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/invoice_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/invoice_view_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/plan_create_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/plan_detail_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/plan_header.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/plan_table.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/platform.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/sales_header.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/components/sales_table.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/order/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/plan/components/create_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/plan/components/details_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/plan/components/fba_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/plan/components/header.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/plan/components/overseas_create_dialog.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/plan/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/sale/components/fbafee_popover.vue` | component_or_auxiliary | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/customized/chelsea/sale/index.vue` | entry_candidate | Chelsea 客户定制工作区 | 未映射，未新增入口 |
| `src/views/dashboard/components/adchart.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/comparechart.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/goodsrank.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/notice.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/personrank.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/piechart.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/salechart.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/service.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/stockchart.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/components/storeshow.vue` | component_or_auxiliary | 数据看板 | /operations?view=sales-traffic |
| `src/views/dashboard/index.vue` | entry_candidate | 数据看板 | /operations?view=sales-traffic |
| `src/views/erp/baseinfo/brand/index.vue` | entry_candidate | 商品品牌档案 | /dashboard |
| `src/views/erp/baseinfo/category/index.vue` | entry_candidate | 商品品类档案 | /dashboard |
| `src/views/erp/baseinfo/material/components/header.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/components/record.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/consumable.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/consumableDialog.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/details/components/listinfo.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/details/index.vue` | entry_candidate | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/assemble_info.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/base.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/consumables.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/logistics.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/parent_info.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/purchase.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/purchase_price_dialog.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/components/specs.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/editinfo/index.vue` | entry_candidate | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/index.vue` | entry_candidate | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/materialDialog.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/package.vue` | component_or_auxiliary | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/material/photoupload/index.vue` | entry_candidate | 商品 / SKU | /dashboard |
| `src/views/erp/baseinfo/quote/index.vue` | entry_candidate | 供应商报价单 | /operations?view=purchase-orders |
| `src/views/erp/baseinfo/supplier/components/table.vue` | component_or_auxiliary | 供应商 | /operations?view=suppliers |
| `src/views/erp/baseinfo/supplier/index.vue` | entry_candidate | 供应商 | /operations?view=suppliers |
| `src/views/erp/baseinfo/supplier/supplier_dialog.vue` | component_or_auxiliary | 供应商 | /operations?view=suppliers |
| `src/views/erp/components/assembly_dialog.vue` | component_or_auxiliary | ERP 共享界面组件 | 未映射，未新增入口 |
| `src/views/erp/components/download_dialog.vue` | component_or_auxiliary | ERP 共享界面组件 | 未映射，未新增入口 |
| `src/views/erp/components/shelfInvOpt.vue` | component_or_auxiliary | ERP 共享界面组件 | 未映射，未新增入口 |
| `src/views/erp/finance/account/components/finItem.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/account/components/finRecord.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/account/components/lineChart.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/account/components/paymethod_index_dialog.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/account/components/pieChart.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/account/components/table.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/account/index.vue` | entry_candidate | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/alibabaSettlement/components/order.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/alibabaSettlement/components/pay.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/alibabaSettlement/components/returnorder.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/alibabaSettlement/components/returnpay.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/alibabaSettlement/index.vue` | entry_candidate | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/exchangeRate/index.vue` | entry_candidate | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/inventoryValue/components/fba.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/inventoryValue/components/self.vue` | component_or_auxiliary | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/inventoryValue/index.vue` | entry_candidate | ERP 财务 | /operations?view=finance |
| `src/views/erp/finance/paymentRequest/components/details.vue` | component_or_auxiliary | 费用 / 请款 | /operations?view=expense-management |
| `src/views/erp/finance/paymentRequest/components/table.vue` | component_or_auxiliary | 费用 / 请款 | /operations?view=expense-management |
| `src/views/erp/finance/paymentRequest/index.vue` | entry_candidate | 费用 / 请款 | /operations?view=expense-management |
| `src/views/erp/purchase/change/components/create.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/change/components/details.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/change/components/header.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/change/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/components/preplan.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/consumable/components/consumable_material.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/consumable/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/open1688/bind/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/open1688/order/open1688order.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/arrival_record.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/assembly.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/auto_price_dialog.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/change_records.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/create.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/deliverydate.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/details.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/logistics_record.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/order_record.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/pay_record.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/payment.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/printip.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/receipt.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/remark_dialog.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/shipfee_dialog.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/skuTable.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/sku_table_inner_dailog.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/components/table.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/order_dialog.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/orders/records.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/plan_amz/components/expand_table.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/plan_amz/components/header.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/plan_amz/components/plan_select.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/plan_amz/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/plan_amz/plan_submit/detail.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/plan_amz/plan_submit/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/process/components/create.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/process/components/details.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/process/components/header.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/process/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/report/detail/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/report/payment/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/report/receive/components/storageDetail_table.vue` | component_or_auxiliary | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/report/receive/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/report/summary/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/purchase/report/time/index.vue` | entry_candidate | 采购 | /operations?view=purchase-orders |
| `src/views/erp/ship/orderblank/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/quota/components/shelfproduct.vue` | component_or_auxiliary | 物流报价 | /operations?view=first-mile |
| `src/views/erp/ship/quota/index.vue` | entry_candidate | 物流报价 | /operations?view=first-mile |
| `src/views/erp/ship/ship_plan/components/afterplan_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/check_data_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/delivery_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/expand_table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/header.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/remarks_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/ship_record.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/shipmarket_rank.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/components/split_plan_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/plan_submit/eu_split.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/plan_submit/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/ship_plan/plan_submit/market_plan.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/approve/components/list.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/approve/components/split_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/approve/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/approve/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/create/components/form.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/create/components/mateiralDialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/create/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/list/components/header.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/list/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_add/list/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/components/async.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/components/asyncdailog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/components/header.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/components/transinfo.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/components/transnumber.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/list/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/four_receive.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/one_picking.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/print_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/shipment_info.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/shipment_operator.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/three_deliver.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/components/two_box.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/shipment_handing/shipstep/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/ship/transportation/components/compare.vue` | component_or_auxiliary | 头程物流 | /operations?view=first-mile |
| `src/views/erp/ship/transportation/components/list.vue` | component_or_auxiliary | 头程物流 | /operations?view=first-mile |
| `src/views/erp/ship/transportation/components/trans_type_dialog.vue` | component_or_auxiliary | 头程物流 | /operations?view=first-mile |
| `src/views/erp/ship/transportation/details_transportation.vue` | component_or_auxiliary | 头程物流 | /operations?view=first-mile |
| `src/views/erp/ship/transportation/edit_transportation.vue` | component_or_auxiliary | 头程物流 | /operations?view=first-mile |
| `src/views/erp/ship/transportation/index.vue` | entry_candidate | 头程物流 | /operations?view=first-mile |
| `src/views/erp/shipv2/quote/channel.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/components/channel_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/components/channel_type.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/components/create_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/components/price_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/components/protocol_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/components/reset_password_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/order.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/overview.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/price.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/purchase/quote.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/quote.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/setting.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/quote/supplier.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/approve/components/list.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/approve/components/split_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/approve/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/approve/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/create/components/form.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/create/components/mateiralDialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/create/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/list/components/async.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/list/components/asyncdailog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/list/components/header.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/list/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/list/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/box_analysis_dialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/box_plan.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/box_table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/box_table_case.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/consumable.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/footer.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/header.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/operation.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/planCancel.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/planCreate.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/planShipped.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/pre.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/components/trans.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/four_end.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/one_pick.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/placement_confirm.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/three_ship.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_add/shipstep/two_box.vue` | component_or_auxiliary | FBA 装箱 | /operations?view=fba-boxing |
| `src/views/erp/shipv2/shipment_handing/list/components/header.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/list/components/quoteDialog.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/list/components/table.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/list/components/transinfo.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/list/components/transnumber.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/list/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_clearance.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_data.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_declaration.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_declaration_xml.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_inventory_xml.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_order_xml.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_picking.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/customs_summary.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/destination.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/four_receive.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/ship_box.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/ship_box_case.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/shipment_info.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/shipment_operator.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/three_deliver.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/components/two_box.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/index.vue` | entry_candidate | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/shipv2/shipment_handing/shipstep/index_tab.vue` | component_or_auxiliary | FBA 物流 | /operations?view=fulfillment |
| `src/views/erp/thirdparty/components/edit_dialog.vue` | component_or_auxiliary | 物流商与海外仓 API 配置 | /logistics |
| `src/views/erp/thirdparty/index.vue` | entry_candidate | 物流商与海外仓 API 配置 | /logistics |
| `src/views/erp/warehouse/address/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/base/components/childrenlist.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/edit.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/parentlist.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/thirdparty/k5.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/thirdparty/ops.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/thirdparty/xl.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/thirdparty/yc.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/thirdparty_bind_dialog.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/components/thirdparty_oversea.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/index.vue` | entry_candidate | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/base/warehouseDialog.vue` | component_or_auxiliary | 仓库档案 | /logistics/warehouse?tab=warehouses |
| `src/views/erp/warehouse/exchange/components/create.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/exchange/components/details.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/exchange/components/header.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/exchange/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/fee/detail_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/fee/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/inbound/components/create.vue` | component_or_auxiliary | 入库 | /logistics/warehouse?tab=receipts |
| `src/views/erp/warehouse/inbound/components/create_dialog.vue` | component_or_auxiliary | 入库 | /logistics/warehouse?tab=receipts |
| `src/views/erp/warehouse/inbound/components/details.vue` | component_or_auxiliary | 入库 | /logistics/warehouse?tab=receipts |
| `src/views/erp/warehouse/inbound/components/table.vue` | component_or_auxiliary | 入库 | /logistics/warehouse?tab=receipts |
| `src/views/erp/warehouse/inbound/index.vue` | entry_candidate | 入库 | /logistics/warehouse?tab=receipts |
| `src/views/erp/warehouse/inventory/daily/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/inventory/report/base/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/inventory/report/turns/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/inventory/report/unsalable/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/outbound/components/create.vue` | component_or_auxiliary | 出库 | /logistics/warehouse?tab=reservations |
| `src/views/erp/warehouse/outbound/components/create_dialog.vue` | component_or_auxiliary | 出库 | /logistics/warehouse?tab=reservations |
| `src/views/erp/warehouse/outbound/components/details.vue` | component_or_auxiliary | 出库 | /logistics/warehouse?tab=reservations |
| `src/views/erp/warehouse/outbound/components/table.vue` | component_or_auxiliary | 出库 | /logistics/warehouse?tab=reservations |
| `src/views/erp/warehouse/outbound/index.vue` | entry_candidate | 出库 | /logistics/warehouse?tab=reservations |
| `src/views/erp/warehouse/overseas/inv/components/create.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/inv/components/inv_header.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/inv/components/inv_his_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/inv/components/invoice_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/inv/components/plan_create_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/inv/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/order/components/create.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/order/components/invoice_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/order/components/invoice_view_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/order/components/platform.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/order/components/sales_header.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/order/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/PurchaseDialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/ShipDialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/arrival_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/delivery_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/expand_table.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/header.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/plan_select.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/salechart.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/components/ship_record.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/plan_submit/detail.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/plan/plan_submit/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/simpleplan/components/plan_create_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/simpleplan/components/plan_detail_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/simpleplan/components/plan_header.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/simpleplan/components/platform.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/simpleplan/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/box_table.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/create.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/create_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/details.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/header.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/logistics.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/components/split_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/overseas/stock/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/record/components/table.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/record/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/base/shelf_tree.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/create/components/shelf_card.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/create/components/shelf_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/create/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/inv/components/shelf_product.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/inv/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/shelf/operator/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/components/create.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/components/create_dialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/components/details.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/components/sku_inventory.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/components/table.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/components/uploadDialog.vue` | component_or_auxiliary | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/stocktake/index.vue` | entry_candidate | 公司仓库存 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/transfer/components/create.vue` | component_or_auxiliary | 调拨 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/transfer/components/details.vue` | component_or_auxiliary | 调拨 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/transfer/components/header.vue` | component_or_auxiliary | 调拨 | /logistics/warehouse?tab=balances |
| `src/views/erp/warehouse/transfer/index.vue` | entry_candidate | 调拨 | /logistics/warehouse?tab=balances |
| `src/views/finance/auxiliary/items/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/auxiliary/types/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/category/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/currency/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/entries/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/ledger/balance/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/ledger/detail/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/ledger/general/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/log/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/periods.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/add_subject_dialog.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/amazon_fin_month_report.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/feishu_table_bind.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/feishu_table_record.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/feishu_table_record_filter.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/other_custom.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/period_change_rate.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template/period_profit_loss_transfer.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template-tree.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/template.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/voucher_log_dialog.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/components/vouchers.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/periods/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/items/components/report_balance.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/items/components/report_cashflow.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/items/components/report_equity.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/items/components/report_income.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/items/components/report_sheet.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/items/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/templates/components/mapping_rules_panel.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/templates/components/template_item_custom_dialog.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/templates/components/template_item_edit.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/templates/components/template_items.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/report/templates/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/subjects/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/vouchers/create/components/ImportVoucherDialog.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/vouchers/create/components/upload_status.vue` | component_or_auxiliary | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/vouchers/create/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/vouchers/list/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/finance/vouchertype/index.vue` | entry_candidate | 总账 / 凭证 / 财务 | /operations?view=finance |
| `src/views/sys/Login.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/Register.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/SSOLogin.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/blank/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/client/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/customer/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/customer/order/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/deepseek/components/MarkdownRenderer.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/deepseek/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/dept/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/dict/components/DictItem.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/dict/components/DictType.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/dict/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/feishu/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/fileuser/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/gen/basicInfoForm.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/gen/editTable.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/gen/genInfoForm.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/gen/importTable.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/gen/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/holiday/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/menu/components/Menu.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/menu/components/Perm.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/menu/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/movedata/components/backup.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/movedata/components/movetable.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/movedata/components/settlement.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/movedata/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/notepad/content_dialog.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/notepad/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/notify/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/online/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/ruleAuth/components/menu_list.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/ruleAuth/components/page_list.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/ruleAuth/components/role_list.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/ruleAuth/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/subUser/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/swagger/amazon.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/swagger/erp.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/swagger/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/tag/components/sysTagGroups.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/tag/components/sysTags.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/tag/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/tariffpackages/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/task/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/userCenter/components/accountSafe.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/components/buypackage.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/components/card.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/components/logoff.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/components/package.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/components/unbind.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/components/wechat.vue` | component_or_auxiliary | 系统 | /settings |
| `src/views/sys/userCenter/index.vue` | entry_candidate | 系统 | /settings |
| `src/views/sys/userCenter/resetPassword.vue` | component_or_auxiliary | 系统 | /settings |

import { randomUUID } from "node:crypto";
import type { Brief, Competitor, Draft, Supplier, TagsResult } from "../types";
import { estimateSales } from "../snapshot/estimateSales";
export function buildDraft(slug: string, brief: Brief, competitors: Competitor[], suppliers: Supplier[], tags: TagsResult): Draft {
  const size = { length: 0, width: 0, height: 0 };
  const product: Draft["product"] = {
    id: randomUUID(), sku: "DRAFT", chineseName: brief.chineseName || brief.keyword, englishName: brief.englishName || brief.keyword,
    asin: "", developer: "", purchasePrice: 0, status: "pending", supplierName: suppliers[0]?.shopName ?? "", supplierUrl: suppliers[0]?.url ?? "",
    specs: "", purchaseLeadTime: "", createdAt: new Date().toISOString(), keywords: brief.keyword,
    note: "选品流水线草稿；销量为未校准估算，定价/成本/认证/专利均待人工核实。竞品图片不代表自有商品。",
    cancelReason: "", hsCode: "", images: [], competitorAsins: competitors.map(c => c.asin),
    productWeightG: 0, packageWeightG: 0, productSizeCm: size, packageSizeCm: { ...size }, workflowStage: "selection_pending",
    workbookDetail: {
      title: brief.chineseName || brief.keyword,
      pricingRows: [{ name: brief.keyword, suggestedPrice: brief.priceMax ?? 0 }],
      competitors: competitors.map(c => {
        const points = Object.entries(tags.countByAsin[c.asin] ?? {}).sort((a,b) => b[1]-a[1]).map(([tag,count]) => `${tag}: ${count}`);
        const sales = estimateSales(c.bsr);
        return { type: "参考竞品", asin: c.asin, heuristic: true, sales30Days: sales === null ? "未知" : `估算 ${sales}（未校准）`, variantCount: String(c.variations?.length ?? ""), variantType: c.variations?.join("; ") ?? "", hotVariantImage: c.imageAsset?.thumbUrl ?? "", hotVariantImageAsset: c.imageAsset, hotVariantSpec: c.title, hotVariantPrice: String(c.price ?? ""), reviewCount: String(c.reviewsCount ?? ""), rating: String(c.rating ?? ""), negativePoint1: points[0] ?? "", negativePoint2: points[1] ?? "", negativePoint3: points[2] ?? "", note: points.join("; ") };
      }),
      suppliers: suppliers.map(s => ({ productUrl: s.url, factoryName: s.shopName, configuration: `${s.title}；页面报价 ${s.price}（币种/阶梯待核实）`, moq: s.moq })),
      keywords: [{ keyword: brief.keyword }], remark: "价格/销量/供应商为采集线索，不代表已验证数据。",
    },
  };
  return { schemaVersion: 1, slug, brief, competitors: competitors.map(c => ({ ...c, sales30Days: { value: estimateSales(c.bsr), heuristic: true, method: "uncalibrated_bsr_power_law" } })), suppliers, tags, product };
}

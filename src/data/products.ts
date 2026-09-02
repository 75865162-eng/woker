import type { Product, ProductStatus } from "@/lib/products/types";

export const productStatusLabels: Record<ProductStatus, string> = {
  listing_confirming: "确认上架",
  pending: "待开发",
  developing: "开发中",
  ops_review: "运营确认中",
  design_in_progress: "美工处理中",
  listed: "已上架",
  canceled: "已取消",
  delisted: "已下架",
  patent_risk: "专利风险",
};

export const productStatusTones: Record<ProductStatus, "gray" | "blue" | "green" | "amber" | "red"> = {
  listing_confirming: "amber",
  pending: "gray",
  developing: "blue",
  ops_review: "amber",
  design_in_progress: "blue",
  listed: "green",
  canceled: "red",
  delisted: "amber",
  patent_risk: "red",
};

export const productStatusOptions: { value: ProductStatus; label: string }[] = [
  { value: "pending", label: productStatusLabels.pending },
  { value: "developing", label: productStatusLabels.developing },
  { value: "ops_review", label: productStatusLabels.ops_review },
  { value: "listing_confirming", label: productStatusLabels.listing_confirming },
  { value: "design_in_progress", label: productStatusLabels.design_in_progress },
  { value: "listed", label: productStatusLabels.listed },
  { value: "canceled", label: productStatusLabels.canceled },
  { value: "delisted", label: productStatusLabels.delisted },
  { value: "patent_risk", label: productStatusLabels.patent_risk },
];

export const newProductStatusOptions: { value: ProductStatus; label: string }[] = [
  { value: "pending", label: productStatusLabels.pending },
  { value: "developing", label: productStatusLabels.developing },
  { value: "ops_review", label: productStatusLabels.ops_review },
];

type ProductSeed = {
  chineseName: string;
  englishName: string;
  keywords: string;
  specs: string;
  hsCode: string;
  purchasePrice: number;
  productWeightG: number;
  productSizeCm: Product["productSizeCm"];
};

const productSeeds: ProductSeed[] = [
  { chineseName: "浓缩咖啡机镜子", englishName: "Espresso Shot Mirror", keywords: "espresso shot mirror,espresso mirror", specs: "普通磁吸 / 强磁；底座+引磁片", hsCode: "", purchasePrice: 6.5405, productWeightG: 100, productSizeCm: { length: 10, width: 10, height: 5 } },
  { chineseName: "硅胶杯垫套装", englishName: "Silicone Coaster Set", keywords: "coaster,silicone mat,table protector", specs: "6片装；黑白灰", hsCode: "3924100000", purchasePrice: 2.35, productWeightG: 180, productSizeCm: { length: 10, width: 10, height: 0.5 } },
  { chineseName: "抽屉分隔收纳盒", englishName: "Expandable Drawer Organizer", keywords: "drawer organizer,kitchen storage", specs: "白色；可伸缩", hsCode: "3924900000", purchasePrice: 8.9, productWeightG: 760, productSizeCm: { length: 38, width: 28, height: 6 } },
  { chineseName: "厨房硅胶油刷", englishName: "Silicone Basting Brush Set", keywords: "basting brush,bbq brush,kitchen tool", specs: "3支装；耐高温", hsCode: "3924100000", purchasePrice: 1.65, productWeightG: 120, productSizeCm: { length: 21, width: 3.5, height: 1.5 } },
  { chineseName: "不锈钢量勺套装", englishName: "Stainless Steel Measuring Spoons", keywords: "measuring spoon,baking tool,kitchen", specs: "6件套；银色", hsCode: "8215990000", purchasePrice: 3.2, productWeightG: 210, productSizeCm: { length: 16, width: 4, height: 3 } },
  { chineseName: "密封食品储物罐", englishName: "Airtight Food Storage Containers", keywords: "food container,pantry organizer,airtight jar", specs: "4件套；透明", hsCode: "3924100000", purchasePrice: 7.6, productWeightG: 880, productSizeCm: { length: 15, width: 10, height: 18 } },
  { chineseName: "磁吸调味罐", englishName: "Magnetic Spice Jars", keywords: "spice jar,magnetic container,kitchen organizer", specs: "12只装；带标签", hsCode: "7323930000", purchasePrice: 6.4, productWeightG: 620, productSizeCm: { length: 6, width: 6, height: 4.5 } },
  { chineseName: "折叠洗菜篮", englishName: "Collapsible Colander Basket", keywords: "collapsible colander,strainer basket,kitchen sink", specs: "蓝灰色；可折叠", hsCode: "3924100000", purchasePrice: 3.95, productWeightG: 280, productSizeCm: { length: 31, width: 23, height: 9 } },
];

const developers = ["陈林", "王悦", "李舟", "赵敏"];
const suppliers = ["义乌尚品家居", "宁波优选塑业", "深圳新迈电子", "广州万合日用品"];
const statuses: ProductStatus[] = ["pending", "developing", "ops_review", "listing_confirming", "design_in_progress", "canceled", "delisted", "patent_risk"];
const leadTimes = ["3天", "5天", "7天", "10天"];

export const initialProducts: Product[] = productSeeds.map((seed, index) => {
  const sku = String(index).padStart(4, "0");
  const packageSizeCm = {
    length: Number((seed.productSizeCm.length + 2).toFixed(1)),
    width: Number((seed.productSizeCm.width + 2).toFixed(1)),
    height: Number((seed.productSizeCm.height + 2).toFixed(1)),
  };

  return {
    id: `prod-${sku}`,
    sku,
    chineseName: seed.chineseName,
    englishName: seed.englishName,
    asin: index === 0 ? "" : index % 4 === 1 ? "" : `B0${String(10000000 + index * 7391).slice(0, 8)}`,
    developer: index === 0 ? "黄思涵" : developers[index % developers.length],
    purchasePrice: seed.purchasePrice,
    status: index === 0 ? "developing" : statuses[index % statuses.length],
    supplierName: index === 0 ? "深圳泰沁数码科技有限公司" : suppliers[index % suppliers.length],
    supplierUrl: index === 0 ? "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0" : `https://example.com/supplier/${sku}`,
    specs: seed.specs,
    purchaseLeadTime: index === 0 ? "" : leadTimes[index % leadTimes.length],
    createdAt: index === 0 ? "2026-07-23 20:37:13" : `2026-${String(6 + Math.floor(index / 30)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")} 00:00:00`,
    keywords: seed.keywords,
    note: index === 0 ? "咖啡爱好者 / 咖啡师用于观察萃取液流出状态；重点改进强磁底座、3M 背胶引磁片、风琴盒和说明书。" : index % 5 === 4 ? "注意检查外观专利与关键词合规。" : "演示数据，可在详情页继续补充采购和上架信息。",
    cancelReason: statuses[index % statuses.length] === "canceled" ? "演示数据：供应商报价或合规风险不符合继续开发要求。" : "",
    hsCode: seed.hsCode,
    images: [],
    competitorAsins: index === 0 ? ["B0D2WNHF3V", "B0BJP1FM72", "B0DM1TB116", "B0F9Y1C7MZ", "B0GVDVJDVH", "B0BXCLX3HC"] : [`B0${String(20000000 + index * 5179).slice(0, 8)}`, `B0${String(30000000 + index * 6833).slice(0, 8)}`],
    productWeightG: seed.productWeightG,
    packageWeightG: index === 0 ? 108.86 : seed.productWeightG + 90 + (index % 6) * 25,
    productSizeCm: seed.productSizeCm,
    packageSizeCm: index === 0 ? { length: 9.14, width: 9.14, height: 5.33 } : packageSizeCm,
  };
});

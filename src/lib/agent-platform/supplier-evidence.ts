import type { MarketResearchReport } from "./market";
import type { SupplierAnalysisReport } from "./supplier";

type SelectionSource = NonNullable<MarketResearchReport["selectionSource"]>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Presence (including an empty shortlist) selects the evidence path; invalid data never falls back. */
export function supplierSelectionSource(productReport: unknown): SelectionSource | undefined {
  if (!record(productReport) || !record(productReport.sourceMarketReport)) return undefined;
  const market = productReport.sourceMarketReport;
  if (!("selectionSource" in market)) return undefined;
  const source = market.selectionSource;
  if (!record(source) || source.schemaVersion !== 1 || typeof source.fileId !== "string" || !source.fileId ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(source.sha256) || typeof source.slug !== "string" || !source.slug ||
      typeof source.importedAt !== "string" || !Number.isFinite(Date.parse(source.importedAt)) ||
      typeof source.stale !== "boolean" || !Array.isArray(source.suppliers) || source.suppliers.length > 20) {
    throw new Error("Round B 供应线索来源无效，请重新从 Market 交接。");
  }
  const suppliers = source.suppliers.map((item) => {
    if (!record(item) || !["title", "url", "shopName", "price", "moq"].every((key) => typeof item[key] === "string" && item[key].length <= 2000) ||
        !item.title || !/^https:\/\/detail\.1688\.com\/offer\/\d+\.html$/.test(String(item.url))) {
      throw new Error("Round B 供应线索无效，请核对 1688 来源。");
    }
    return { title: String(item.title), url: String(item.url), shopName: String(item.shopName), price: String(item.price), moq: String(item.moq) };
  });
  return { fileId: source.fileId, sha256: source.sha256, slug: source.slug, schemaVersion: 1, importedAt: source.importedAt, stale: source.stale, suppliers };
}

export function buildSupplierEvidenceReport(source: SelectionSource, goal: string, marketplace: string, productSummary: string, generatedAt: string): SupplierAnalysisReport {
  const stale = source.stale || Date.parse(generatedAt) - Date.parse(source.importedAt) > 7 * 86400_000;
  const risks = ["用户提供的 1688 线索未经独立核验；页面价格不是正式报价。", "联系人、产能、样品费、运费和交期均待询价。", ...(stale ? ["证据已过期，请重新采集并核实。"] : [])];
  const candidates = source.suppliers.map((item, index) => ({
    supplierId: `round-b-${index + 1}`, supplierName: item.shopName || item.title, sourceUrl: item.url,
    summary: item.title, strengths: [] as string[], risks, confidence: 0,
  }));
  return {
    goal, marketplace, productSummary, selectionSource: { ...source, stale }, sourcingStatus: candidates.length ? "NEEDS_VERIFICATION" : "NEEDS_DATA",
    supplierRecommendations: candidates,
    quotationAnalysis: source.suppliers.map((item, index) => ({
      supplierId: candidates[index].supplierId, supplierName: candidates[index].supplierName, sourceUrl: item.url,
      contactName: "待核实", contactEmail: "", moq: item.moq || "待核实", unitPrice: item.price || "未报价",
      shippingEstimate: "待核实", leadTime: "待核实", sampleCost: "待核实", notes: "1688 页面线索，非正式报价；币种、阶梯价格及适用条件待确认。", score: null,
    })),
    rfqDraft: { subject: `询价草稿：${productSummary}`, objective: "待人工确认供应商后发送；尚未发送询价。", productSummary,
      requiredCapabilities: [], targetPrice: "待确认", targetLeadTime: "待确认",
      questions: ["请确认是否能满足 PRD 与验收要求。", "请提供币种、阶梯含税价格、MOQ 与报价有效期。", "请确认联系人、样品费、运费、交期与合规资料。"] },
    supplierProjectDraft: { projectName: "Round B 供应核实草案", objective: "核实线索并由采购选定供应商。",
      stages: [{ name: "人工核实与询价", goal: "核实原始链接、联系人和正式报价", owner: "采购" }],
      nextStep: candidates.length ? "人工选择候选供应商，核实报价后审阅刊登交接；未创建采购单。" : "短名单为空，请补充 Round B 供应线索；未选定供应商。", risks },
    evidence: source.suppliers.map((item) => ({ claim: `${item.title}：用户提供的供应线索，待核实`, dataSource: item.url,
      toolId: "supplier.database.search", metric: "supplier-lead", value: { ...item, fileId: source.fileId, sha256: source.sha256 }, timestamp: source.importedAt })),
    summary: `已整理 ${candidates.length} 条 Round B 供应线索；未完成供应商核验或正式核价。`,
    recommendation: candidates.length ? "请人工核实供应商及正式报价，再审阅交接；询价草稿尚未发送。" : "供应线索不足，请补充短名单；不会生成模拟工厂。", generatedAt,
  };
}

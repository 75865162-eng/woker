import { findSkill, listSkills } from "@/lib/lili/catalog";
import { skillDataContracts } from "@/lib/amazon-sync/skill-contracts";
import type { ExportFormat, SkillInput, SkillView } from "./types";

/**
 * Skill 工作台的只读配置层。
 *
 * 数据源唯一事实来源仍是 src/data/lili（经 lib/lili/catalog 暴露），此处不新建第二套 Skill 注册表、
 * 不写数据库。Lili 的 Skill 定义没有 inputsSchema / exportFormat 字段，因此这里用保守派生：
 * - 参数表单：所有 Skill 统一提供站点 / 时间范围 / ASIN(可选) / 补充说明(可选) 四个通用参数；
 * - 导出格式：按分类与 slug 派生，绝不伪造"Skill 声明了某格式"这一事实，UI 需标注为系统派生。
 * 缺失或无法判定时保持默认值，不臆造字段。
 */

const MARKETPLACES = [
  { value: "US", label: "美国 US" },
  { value: "DE", label: "德国 DE" },
  { value: "UK", label: "英国 UK" },
  { value: "JP", label: "日本 JP" },
  { value: "FR", label: "法国 FR" },
  { value: "CA", label: "加拿大 CA" },
];

const DATE_RANGES = [
  { value: "last7days", label: "最近 7 天" },
  { value: "last14days", label: "最近 14 天" },
  { value: "last30days", label: "最近 30 天" },
  { value: "last90days", label: "最近 90 天" },
];

const CATEGORY_LABELS: Record<string, string> = {
  ads: "广告",
  research: "市场与选品",
  listing: "Listing",
  ops: "运营",
  report: "报告",
  profit: "利润与财务",
  inventory: "补货与库存",
  promo: "促销",
  // skills.json 原始分类值（taxonomy 未覆盖 cat 时由 catalog 回退到 skill.cat）
  market: "市场与选品",
  keywords: "关键词",
  restock: "补货与库存",
  data: "数据",
  compliance: "合规",
  returns: "退货分析",
  orders: "订单",
};

const XLSX_CATEGORIES = new Set(["inventory", "profit", "restock", "returns", "orders"]);
const XLSX_SLUG_HINTS = ["keyword", "keywords", "traffic", "reverse"];

function exportFormatFor(category: string, slug: string): ExportFormat {
  if (XLSX_CATEGORIES.has(category)) return "xlsx";
  const normalized = slug.toLowerCase();
  if (XLSX_SLUG_HINTS.some((hint) => normalized.includes(hint))) return "xlsx";
  return "docx";
}

function inputsFor(exportFormat: ExportFormat): SkillInput[] {
  const inputs: SkillInput[] = [
    {
      key: "marketplace",
      label: "站点",
      kind: "marketplace",
      required: true,
      options: MARKETPLACES,
      defaultValue: "US",
    },
    {
      key: "dateRange",
      label: "时间范围",
      kind: "dateRange",
      required: true,
      options: DATE_RANGES,
      defaultValue: "last30days",
    },
    { key: "asin", label: "ASIN / SKU", kind: "asin", required: false, placeholder: "选填，聚焦单个商品" },
    {
      key: "brief",
      label: "补充说明",
      kind: "text",
      required: false,
      placeholder: "选填，例如目标 ACOS、重点关注的活动等",
    },
  ];
  void exportFormat; // 通用参数目前与导出格式无关，保留入参以便后续按格式扩展。
  return inputs;
}

const dataTablesBySkill = new Map<string, string[]>();
for (const contract of skillDataContracts) {
  const tables = [...new Set(contract.requirements.map((requirement) => requirement.table))];
  dataTablesBySkill.set(contract.skill, tables);
}

export function listSkillViews(): SkillView[] {
  return listSkills().map((skill) => {
    const format = exportFormatFor(skill.category, skill.slug);
    return {
      slug: skill.slug,
      name: skill.nameZh,
      summary: skill.summaryZh,
      category: skill.category,
      categoryLabel: CATEGORY_LABELS[skill.category] ?? skill.category,
      steps: skill.stepsZh,
      tools: skill.tools,
      prompt: skill.promptZh,
      featured: skill.featured,
      isNew: skill.isNew,
      inputs: inputsFor(format),
      exportFormat: format,
      exportFormatLabel: format === "xlsx" ? "Excel 表格 (.xlsx)" : "Word 文档 (.docx)",
      dataTables: dataTablesBySkill.get(skill.slug) ?? [],
    };
  });
}

export function findSkillView(slug: string): SkillView | undefined {
  if (!findSkill(slug)) return undefined;
  return listSkillViews().find((skill) => skill.slug === slug || findSkill(slug)?.slug === skill.slug);
}

export function listSkillCategories(): Array<{ id: string; label: string; count: number }> {
  const views = listSkillViews();
  const counts = new Map<string, number>();
  for (const view of views) counts.set(view.category, (counts.get(view.category) ?? 0) + 1);
  return [
    { id: "all", label: "全部", count: views.length },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: CATEGORY_LABELS[id] ?? id, count })),
  ];
}

/** 通过 catalog 加载 Skill 完整说明正文（markdown），用于运行时的 system 上下文。 */
export async function loadSkillBody(slug: string): Promise<{ view: SkillView; body: string } | undefined> {
  const resolved = findSkill(slug);
  if (!resolved) return undefined;
  const view = findSkillView(resolved.slug);
  if (!view) return undefined;
  const { skillMarkdown } = await import("@/lib/lili/catalog");
  const body = (await skillMarkdown(resolved.slug)) ?? "";
  return { view, body };
}

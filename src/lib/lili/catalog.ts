import { liliApprovalPolicy, liliApprovalInstructionsZh, liliApprovalInstructionsEn } from "./approval-policy";
import rawSkills from "@/data/lili/skills.json";
import rawTaxonomy from "@/data/lili/taxonomy.json";
import rawTools from "@/data/lili/tools.json";
import rawDocs from "@/data/lili/tool-docs.json";
import rawEnglish from "@/data/lili/workflows-en.json";
import rawChinese from "@/data/lili/workflows-zh.json";

export type InputSchema = {
  type?: string;
  properties?: Record<string, InputSchema>;
  required?: string[];
  description?: string;
  items?: InputSchema;
  enum?: unknown[];
};
export type CatalogSkill = {
  slug: string; nameZh: string; nameEn: string; category: string;
  summaryZh: string; summaryEn: string; promptZh: string; promptEn: string;
  stepsZh: string[]; stepsEn: string[]; tools: string[]; featured: boolean; isNew: boolean;
};
export type CatalogWorkflow = {
  slug: string; index: number; category: string; titleZh: string; titleEn: string;
  summaryZh: string; summaryEn: string; promptZh: string; promptEn: string;
  steps: { n: number; zh: string; en: string; skill: string | null }[];
};
export type CatalogTool = {
  name: string; description: string; category: string; readOnly: boolean;
  inputSchema: InputSchema; docs: string; availability: "catalog" | "unmapped";
};
const catalogTools = new Set(["meta_search_skills", "meta_load_skill", "meta_list_workflows"]);
const taxonomy = rawTaxonomy as Record<string, { cat?: string; nameEn?: string; summaryEn?: string; sort?: number; featured?: boolean; isNew?: boolean }>;
const docs = rawDocs as Record<string, string>;

// Shipped definitions only. Never initialize a second database or seed business rows.
export function listSkills(): CatalogSkill[] {
  return rawSkills.map((skill) => {
    const tax = taxonomy[skill.slug];
    const nameEn = tax?.nameEn ?? skill.en;
    const summaryEn = tax?.summaryEn ?? skill.enSum;
    return {
      slug: skill.slug, nameZh: skill.zh, nameEn, category: tax?.cat ?? skill.cat,
      summaryZh: skill.zhSum, summaryEn, stepsZh: skill.stepsZh, stepsEn: skill.stepsEn,
      approvalPolicy: liliApprovalPolicy, tools: skill.tools, featured: tax?.featured ?? false, isNew: tax?.isNew ?? false,
      promptZh: [`使用粒粒lili技能 ${skill.slug}。`, skill.zhSum, "", "按这个顺序做：", ...skill.stepsZh.map((step, i) => `${i + 1}. ${step}`), "", liliApprovalInstructionsZh].join("\n"),
      promptEn: [`Use the 粒粒lili skill ${skill.slug}.`, summaryEn, "", "Do it in this order:", ...skill.stepsEn.map((step, i) => `${i + 1}. ${step}`), "", liliApprovalInstructionsEn].join("\n"),
    };
  }).sort((a, b) => (taxonomy[a.slug]?.sort ?? 500) - (taxonomy[b.slug]?.sort ?? 500) || a.nameEn.localeCompare(b.nameEn));
}

export function findSkill(slug: string) {
  const short = slug.replace(/^(?:duobaoyu-|lili-)/, "");
  return listSkills().find((skill) => skill.slug === short || skill.slug === slug);
}

export async function skillMarkdown(slug: string): Promise<string | undefined> {
  const skill = findSkill(slug);
  if (!skill) return undefined;
  // Full procedures are loaded only for a detail, download or explicit tool call.
  const { default: bodies } = await import("@/data/lili/skill-bodies.json");
  return (bodies as Record<string, string>)[skill.slug];
}

export function listTools(): CatalogTool[] {
  return rawTools.tools.map((tool) => ({
    name: tool.name, description: tool.description, category: tool.name.split("_")[0],
    readOnly: Boolean(tool.annotations.readOnlyHint), inputSchema: tool.inputSchema as InputSchema,
    docs: docs[tool.name] ?? tool.description,
    availability: catalogTools.has(tool.name) ? "catalog" as const : "unmapped" as const,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listWorkflows(): CatalogWorkflow[] {
  return rawChinese.map((item) => {
    const en = rawEnglish.find((row) => row.index === item.index);
    if (!en) throw new Error("LILI_CATALOG_WORKFLOW_TRANSLATION_MISSING");
    return {
      slug: en.slug, index: item.index, category: en.category, titleZh: item.title, titleEn: en.titleEn,
      summaryZh: item.summary, summaryEn: en.summaryEn, approvalPolicy: liliApprovalPolicy, promptZh: item.prompt + "\n\n" + liliApprovalInstructionsZh,
      promptEn: ["Use 粒粒lili and follow this order:", ...en.steps.map((step, i) => `${i + 1}. ${step}`), "", en.close, "", liliApprovalInstructionsEn].join("\n"),
      steps: item.steps.map((zh, i) => ({ n: i + 1, zh, en: en.steps[i] ?? zh, skill: zh.match(/(?:用|Use)\s+([a-z0-9-]+)/)?.[1] ?? en.steps[i]?.match(/(?:用|Use)\s+([a-z0-9-]+)/)?.[1] ?? null })),
    };
  });
}

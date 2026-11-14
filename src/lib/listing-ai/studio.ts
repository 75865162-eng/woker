export const studioMarketplaces = ["US", "UK", "DE", "FR", "IT", "ES", "JP", "CA", "AU"] as const;

export type StudioMarketplace = (typeof studioMarketplaces)[number];

export const studioTones = [
  { id: "professional", label: "专业理性" },
  { id: "friendly", label: "亲和种草" },
  { id: "premium", label: "高端质感" },
  { id: "direct", label: "直给卖点" },
] as const;

export type StudioTone = (typeof studioTones)[number]["id"];

export interface StudioProductInput {
  marketplace: StudioMarketplace;
  tone: StudioTone;
  chineseName: string;
  englishName: string;
  brand: string;
  asin: string;
  productType: string;
  targetAudience: string;
  useScenarios: string;
  features: string;
  parameters: string;
  specifications: string;
  keywords: string;
  forbidden: string;
  competitorNames: string;
  competitorListing: string;
  imageNotes: string;
}

export interface StudioImage {
  name: string;
  url: string;
  assetId?: string;
}

export interface StudioImageRun {
  loading: boolean;
  images: StudioImage[];
  error: string;
}

export interface StudioTitleOption {
  type: "seo" | "conversion" | "balanced";
  text: string;
  charCount: number;
  reason: string;
}

export interface StudioBullet {
  index: number;
  text: string;
  sellingPoint: string;
  sourceFact: string;
}

export interface StudioComparisonRow {
  dimension: string;
  competitor: string;
  ours: string;
  gap: string;
  action: string;
  status: "ok" | "needs-data";
}

export interface StudioImageIdea {
  slot: string;
  theme: string;
  sellingPoint: string;
  prompt: string;
  negativePrompt: string;
}

export interface StudioAnalysis {
  position: string;
  strength: string[];
  weakness: string[];
  opportunity: string[];
  risk: string[];
}

export interface StudioScores {
  title: number;
  keywords: number;
  conversion: number;
  compliance: number;
}

export interface StudioResult {
  titles: StudioTitleOption[];
  bullets: StudioBullet[];
  description: string;
  searchTerms: string;
  comparison: StudioComparisonRow[];
  imageIdeas: StudioImageIdea[];
  missingFacts: string[];
  aiAnalysis: StudioAnalysis;
  scores: StudioScores;
}

export const studioComparisonDimensions = [
  "标题结构",
  "核心关键词覆盖",
  "第一卖点呈现",
  "材质与做工",
  "尺寸与规格",
  "使用场景",
  "痛点与解决方案",
  "合规与风险",
  "图片策略",
] as const;

export const studioScoreFields = [
  { id: "title", label: "标题质量" },
  { id: "keywords", label: "关键词覆盖" },
  { id: "conversion", label: "转化力" },
  { id: "compliance", label: "合规安全" },
] as const;

export const studioTitleMaxChars = 200;
export const studioSearchTermMaxBytes = 250;

export const emptyStudioInput: StudioProductInput = {
  marketplace: "US",
  tone: "professional",
  chineseName: "",
  englishName: "",
  brand: "",
  asin: "",
  productType: "",
  targetAudience: "",
  useScenarios: "",
  features: "",
  parameters: "",
  specifications: "",
  keywords: "",
  forbidden: "",
  competitorNames: "",
  competitorListing: "",
  imageNotes: "",
};

export const emptyStudioAnalysis: StudioAnalysis = {
  position: "",
  strength: [],
  weakness: [],
  opportunity: [],
  risk: [],
};

export const emptyStudioScores: StudioScores = {
  title: 0,
  keywords: 0,
  conversion: 0,
  compliance: 0,
};

const marketplaceRules: Record<StudioMarketplace, string> = {
  US: "Amazon US. English listing. Title must stay within 200 characters including spaces.",
  UK: "Amazon UK. British spelling in English copy. Title within 200 characters.",
  DE: "Amazon Germany. English copy unless specified. No unsupported medical, ranking, or guarantee claims.",
  FR: "Amazon France. English copy unless specified. No unsupported medical, ranking, or guarantee claims.",
  IT: "Amazon Italy. English copy unless specified. No unsupported medical, ranking, or guarantee claims.",
  ES: "Amazon Spain. English copy unless specified. No unsupported medical, ranking, or guarantee claims.",
  JP: "Amazon Japan. Concise, search-oriented copy. Title within 200 characters.",
  CA: "Amazon Canada. Clear English. No unsupported claims.",
  AU: "Amazon Australia. Clear English. No unsupported claims.",
};

function field(label: string, value: string) {
  return `${label}: ${value.trim() || "未提供"}`;
}

export function buildStudioSystemPrompt() {
  return [
    "你是资深亚马逊运营总监 + 电商视觉创意总监，负责把卖家填写的产品资料转成可直接上架的英文 Listing 文案，并输出竞品逐项对比表。",
    "",
    "绝对规则（违反即视为失败）：",
    "1. 只能使用卖家在【产品资料】里提供的事实。禁止编造认证、材质、尺寸、承重、兼容性、专利、保修、医疗功效、销量排名或任何性能数字。",
    "2. 每一条卖点都必须在 sourceFact 里写出它来自哪一项输入（例如「参数-材质: 304 不锈钢」）。找不到依据的，sourceFact 填 NEEDS_DATA，并在 missingFacts 里列出该缺口。",
    "3. 竞品信息缺失时，comparison 的 competitor 字段必须填 NEEDS_DATA，禁止想象竞品做法。",
    "4. 评分必须保守：没有依据的宣传点一律扣分；合规分低于 60 说明当前文案存在下架或投诉风险。",
    "5. 只输出 JSON，不要 markdown 代码块，不要任何前后解释。",
  ].join("\n");
}

export function buildStudioUserPrompt(input: StudioProductInput) {
  const hasCompetitor =
    Boolean(input.competitorNames.trim()) || Boolean(input.competitorListing.trim());

  return `请根据以下资料生成亚马逊 Listing 文案、图片执行方案和竞品逐项对比表。

【市场与语气】
${field("站点", input.marketplace)}
站点规则: ${marketplaceRules[input.marketplace]}
语气: ${input.tone}

【产品基础信息】
${field("中文名称", input.chineseName)}
${field("英文名称", input.englishName)}
${field("品牌", input.brand)}
${field("ASIN", input.asin)}
${field("类目/产品类型", input.productType)}
${field("目标人群", input.targetAudience)}
${field("使用场景", input.useScenarios)}

【产品特点】
${input.features.trim() || "未提供"}

【产品参数】
${input.parameters.trim() || "未提供"}

【规格（尺寸/重量/材质/包装等）】
${input.specifications.trim() || "未提供"}

【目标关键词】
${input.keywords.trim() || "未提供"}

【禁止宣称 / 合规红线】
${input.forbidden.trim() || "未提供"}

【竞品信息】
竞品品牌/ASIN: ${input.competitorNames.trim() || "未提供"}
竞品标题与五点摘录: ${input.competitorListing.trim() || "未提供"}
竞品资料是否可用: ${hasCompetitor ? "可用（仅按摘录内容对比，不要自行补充）" : "未提供（comparison.competitor 全部填 NEEDS_DATA）"}

【图片补充要求】
${input.imageNotes.trim() || "未提供"}

【输出 JSON 结构】
{
  "titles": [
    { "type": "seo", "text": "英文标题", "charCount": 0, "reason": "中文说明这条标题主打什么" },
    { "type": "conversion", "text": "英文标题", "charCount": 0, "reason": "中文说明" },
    { "type": "balanced", "text": "英文标题", "charCount": 0, "reason": "中文说明，并标注推荐" }
  ],
  "bullets": [
    { "index": 1, "text": "英文五点，全大写短语开头 + 冒号 + 说明", "sellingPoint": "中文卖点", "sourceFact": "来源输入项或 NEEDS_DATA" }
  ],
  "description": "英文产品描述，3-5 段，纯文本，不用 HTML 标签",
  "searchTerms": "英文后台搜索词，空格分隔，不重复，不超过 250 字节",
  "comparison": [
    {
      "dimension": "${studioComparisonDimensions.join(" / ")} 之一（必须全部覆盖，顺序一致）",
      "competitor": "竞品做法；无资料时填 NEEDS_DATA",
      "ours": "我方方案",
      "gap": "差异或空白点",
      "action": "建议的具体动作",
      "status": "ok 或 needs-data"
    }
  ],
  "imageIdeas": [
    { "slot": "Main Image", "theme": "中文图片主题", "sellingPoint": "中文对应卖点", "prompt": "English image generation prompt", "negativePrompt": "English negative prompt" }
  ],
  "aiAnalysis": {
    "position": "一句话定位（中文，指出靠什么差异点打动谁）",
    "strength": ["当前方案最有力的 2-4 点，中文"],
    "weakness": ["当前方案的短板或证据缺口，中文"],
    "opportunity": ["竞品没做好、我们可以抢的 2-4 个机会，中文"],
    "risk": ["合规、退货、图文不符等风险，中文"]
  },
  "scores": {
    "title": 0,
    "keywords": 0,
    "conversion": 0,
    "compliance": 0
  },
  "missingFacts": ["上架前必须补齐的信息，中文"]
}

硬性要求：
- titles 必须 3 条，每条 charCount 是真实字符数且不超过 ${studioTitleMaxChars}。
- bullets 必须 5 条，顺序按购买决策优先级排列，每条不超过 500 字符。
- comparison 必须 ${studioComparisonDimensions.length} 行，维度依次为 ${studioComparisonDimensions.join("、")}。
- imageIdeas 必须 6 条，slot 依次为 Main Image、Image 2、Image 3、Image 4、Image 5、Image 6。主图必须是纯白底产品图，不含文字水印促销标。
- aiAnalysis 每项 2-4 条，只依据已提供资料判断，不要套话。
- scores 的 title / keywords / conversion / compliance 都是 0-100 整数。
- 所有英文文案自然地道，不要中式英语，不要堆砌关键词。`;
}

export type StudioRewriteKind = "title" | "bullet" | "description" | "searchTerms";

export const studioRewriteKindLabels: Record<StudioRewriteKind, string> = {
  title: "标题",
  bullet: "五点描述",
  description: "产品描述",
  searchTerms: "后台搜索词",
};

export function buildStudioRewriteSystemPrompt() {
  return [
    "你是亚马逊 Listing 文案编辑。你的任务是按卖家指令改写一段已生成的英文文案。",
    "",
    "绝对规则：",
    "1. 只允许调整结构、语序、措辞、长度和信息取舍，禁止新增卖家没有提供的事实、数字、认证或承诺。",
    "2. 保留原有的事实约束：材质、尺寸、承重等数字必须与原文一致。",
    "3. 不要输出解释、前后缀或 markdown 代码块，只输出改写后的英文文本本身。",
  ].join("\n");
}

export function buildStudioRewriteUserPrompt(params: {
  kind: StudioRewriteKind;
  text: string;
  instruction: string;
  input: StudioProductInput;
}) {
  const { kind, text, instruction, input } = params;

  const limits =
    kind === "title"
      ? `标题必须不超过 ${studioTitleMaxChars} 个字符（含空格）。`
      : kind === "bullet"
        ? "五点描述单条不超过 500 个字符，以全大写短语 + 冒号开头。"
        : kind === "searchTerms"
          ? `后台搜索词用空格分隔、不重复，不超过 ${studioSearchTermMaxBytes} 字节。`
          : "产品描述保持 3-5 段纯文本，不用 HTML 标签。";

  return `改写类型：${studioRewriteKindLabels[kind]}
站点：${input.marketplace}
语气：${input.tone}
硬约束：${limits}

卖家指令：${instruction.trim() || "在保持事实不变的前提下，让表达更精炼、更有说服力。"}

禁止宣称：${input.forbidden.trim() || "未提供"}
产品特点（仅供核对，不得引入新事实）：
${input.features.trim() || "未提供"}

原文：
${text}

请直接输出改写后的英文文本。`;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(asString(value));

  if (!Number.isFinite(numeric)) return 0;

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function asStringList(value: unknown, limit = 6) {
  return asArray(value)
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, limit);
}

function stripJsonFence(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI 返回内容不是可解析的 JSON，请重试或换一个更强的文本模型。");
  }

  return trimmed.slice(start, end + 1);
}

/**
 * 对比表必须固定 9 行、顺序一致，否则表格会出现空洞或维度漂移。
 * 模型漏掉的维度按 NEEDS_DATA 补齐，多出来的维度丢弃。
 */
export function normalizeStudioComparison(value: unknown): StudioComparisonRow[] {
  const rows = asArray(value).map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const competitor = asString(row.competitor) || "NEEDS_DATA";

    return {
      dimension: asString(row.dimension),
      competitor,
      ours: asString(row.ours) || "NEEDS_DATA",
      gap: asString(row.gap),
      action: asString(row.action),
      status: (asString(row.status) === "ok" && competitor !== "NEEDS_DATA"
        ? "ok"
        : "needs-data") as StudioComparisonRow["status"],
    } satisfies StudioComparisonRow;
  });

  return studioComparisonDimensions.map((dimension) => {
    const matched = rows.find(
      (row) => row.dimension === dimension || row.dimension.includes(dimension) || dimension.includes(row.dimension),
    );

    return (
      matched ?? {
        dimension,
        competitor: "NEEDS_DATA",
        ours: "NEEDS_DATA",
        gap: "AI 未产出该维度，需要人工补充。",
        action: "补充竞品该维度的公开信息后重新生成。",
        status: "needs-data",
      }
    );
  });
}

export function parseStudioResult(text: string): StudioResult {
  const parsed = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;

  const titles: StudioTitleOption[] = asArray(parsed.titles)
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const titleText = asString(row.text);
      const type = asString(row.type);

      return {
        type: type === "seo" || type === "conversion" || type === "balanced" ? type : "balanced",
        text: titleText,
        charCount: Array.from(titleText).length,
        reason: asString(row.reason),
      } satisfies StudioTitleOption;
    })
    .filter((item) => item.text)
    .slice(0, 3);

  const bullets: StudioBullet[] = asArray(parsed.bullets)
    .map((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;

      return {
        index: Number(row.index) || index + 1,
        text: asString(row.text),
        sellingPoint: asString(row.sellingPoint),
        sourceFact: asString(row.sourceFact) || "NEEDS_DATA",
      } satisfies StudioBullet;
    })
    .filter((item) => item.text)
    .slice(0, 5);

  const imageIdeas: StudioImageIdea[] = asArray(parsed.imageIdeas)
    .map((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;

      return {
        slot: asString(row.slot) || `Image ${index + 1}`,
        theme: asString(row.theme),
        sellingPoint: asString(row.sellingPoint),
        prompt: asString(row.prompt),
        negativePrompt: asString(row.negativePrompt),
      } satisfies StudioImageIdea;
    })
    .filter((item) => item.prompt)
    .slice(0, 6);

  const rawAnalysis = (parsed.aiAnalysis ?? {}) as Record<string, unknown>;
  const rawScores = (parsed.scores ?? {}) as Record<string, unknown>;

  const result: StudioResult = {
    titles,
    bullets,
    description: asString(parsed.description),
    searchTerms: asString(parsed.searchTerms),
    comparison: normalizeStudioComparison(parsed.comparison),
    imageIdeas,
    missingFacts: asStringList(parsed.missingFacts, 12),
    aiAnalysis: {
      position: asString(rawAnalysis.position),
      strength: asStringList(rawAnalysis.strength),
      weakness: asStringList(rawAnalysis.weakness),
      opportunity: asStringList(rawAnalysis.opportunity),
      risk: asStringList(rawAnalysis.risk),
    },
    scores: {
      title: asScore(rawScores.title),
      keywords: asScore(rawScores.keywords),
      conversion: asScore(rawScores.conversion),
      compliance: asScore(rawScores.compliance),
    },
  };

  if (!result.titles.length && !result.bullets.length && !result.description) {
    throw new Error("AI 没有返回可用的标题或描述，请检查模型输出格式。");
  }

  return result;
}

export function compactStudioImage(image: StudioImage): StudioImage {
  return image.assetId
    ? { name: image.name, url: "", assetId: image.assetId }
    : { name: image.name, url: image.url };
}

export function countSearchTermBytes(value: string) {
  return new TextEncoder().encode(value).length;
}

export function formatStudioCopy(result: StudioResult) {
  const sections = [
    "【标题候选】",
    ...result.titles.map(
      (title, index) => `${index + 1}. [${title.type}] ${title.text} (${title.charCount} chars)`,
    ),
    "",
    "【五点描述】",
    ...result.bullets.map((bullet) => `${bullet.index}. ${bullet.text}`),
    "",
    "【产品描述】",
    result.description,
    "",
    "【后台搜索词】",
    result.searchTerms,
  ];

  return sections.join("\n");
}

export function formatStudioComparison(result: StudioResult) {
  const header = "项目\t竞品\t我方方案\t差异\t建议动作";
  const rows = result.comparison.map((row) =>
    [row.dimension, row.competitor, row.ours, row.gap || "—", row.action || "—"].join("\t"),
  );

  return [header, ...rows].join("\n");
}

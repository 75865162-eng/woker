import type {
  ListingOptimizationRequest,
  ListingOptimizationResult,
} from "@/lib/listing-ai/types";

export interface ImagePreview {
  name: string;
  url: string;
  assetId?: string;
}

export interface CompetitorDraft {
  asin: string;
  sales: string;
  price: string;
  variation: string;
  rating: string;
  reviewCount: string;
  mainImage: ImagePreview[];
  screenshot: ImagePreview[];
  title: string;
  bullets: string;
  targetAudience: string;
  useScenarios: string;
  productFeatures: string;
  buyerConcerns: string;
  negativeReviews: string;
  opportunity: string;
  aplus: string;
  images: ImagePreview[];
}

export interface OwnImageDraft {
  structureNotes: string;
  mainImage: ImagePreview[];
  images: ImagePreview[];
  imageNotes: string[];
  sales: string;
  price: string;
  rating: string;
  reviewCount: string;
}

export interface GalleryInfoRow {
  label: string;
  mineValue: string;
  updateMine: (value: string) => void;
  competitorValue: (competitor: CompetitorDraft) => string;
  updateCompetitor: (columnIndex: number, value: string) => void;
  asin?: boolean;
  multiline?: boolean;
  tall?: boolean;
}

export interface GalleryCellStyle {
  redText?: boolean;
  yellowBg?: boolean;
  redRanges?: Array<{ start: number; end: number }>;
}

export interface GalleryExcelCell {
  value?: unknown;
  font?: { bold?: boolean; color?: { argb?: string } };
  fill?: {
    type?: string;
    pattern?: string;
    fgColor?: { argb?: string };
    bgColor?: { argb?: string };
  };
}

export interface SavedRecord {
  id: string;
  version: number;
  createdAt: string;
  submitter: string;
  productName: string;
  input: ListingOptimizationRequest;
  result: ListingOptimizationResult;
}

export type TitleGeneratorFieldKey =
  | "productChineseName"
  | "currentProductTitle"
  | "asin"
  | "productFeatures"
  | "coreAdWords"
  | "relatedKeywords"
  | "adData"
  | "competitorTitle1"
  | "competitorTitle2"
  | "competitorTitle3";

export type TitleGeneratorMode = "old" | "new";

export interface TitleGeneratorField {
  key: TitleGeneratorFieldKey;
  label: string;
  weight: number;
  value: string;
}

export interface TitleGeneratorModeDraft {
  fields: TitleGeneratorField[];
  results: string[];
  history: TitleGeneratorHistoryRecord[];
}

export interface TitleGeneratorDraft {
  mode: TitleGeneratorMode;
  fields: TitleGeneratorField[];
  prompt: string;
  results: string[];
  history: TitleGeneratorHistoryRecord[];
  modes: Record<TitleGeneratorMode, TitleGeneratorModeDraft>;
}

export interface TitleGeneratorHistoryRecord {
  id: string;
  createdAt: string;
  mode: TitleGeneratorMode;
  fields: TitleGeneratorField[];
  prompt: string;
  results: string[];
}

export type DescriptionGeneratorFieldKey =
  | "competitorDescription1"
  | "competitorDescription2"
  | "competitorDescription3";

export interface DescriptionGeneratorField {
  key: DescriptionGeneratorFieldKey;
  label: string;
  weight: number;
  value: string;
}

export interface DescriptionGeneratorHistoryRecord {
  id: string;
  createdAt: string;
  mode: TitleGeneratorMode;
  fields: DescriptionGeneratorField[];
  prompt: string;
  results: string[];
}

export interface DescriptionGeneratorDraft {
  fields: DescriptionGeneratorField[];
  prompt: string;
  results: string[];
  history: DescriptionGeneratorHistoryRecord[];
}

export type ImageGeneratorViewKey =
  | "front"
  | "left"
  | "right"
  | "back"
  | "bottom"
  | "top";

export interface ImageGeneratorDraft {
  ownViews: Record<ImageGeneratorViewKey, ImagePreview[]>;
  competitorImages: ImagePreview[];
  prompt: string;
  generatedImages: ImagePreview[];
  history: ImageGenerationHistoryRecord[];
  lastRunAt: string;
}

export interface ImageGenerationHistoryRecord {
  id: string;
  createdAt: string;
  prompt: string;
  ownViewCount: number;
  competitorImageCount: number;
  images: ImagePreview[];
}

export type TabId =
  | "input"
  | "visual"
  | "analysis"
  | "listing"
  | "imagePlan"
  | "chat"
  | "review"
  | "upscale";

export interface WorkspaceDraft {
  input: ListingOptimizationRequest;
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  titleGenerator: TitleGeneratorDraft;
  descriptionGenerator: DescriptionGeneratorDraft;
  imageGenerator: ImageGeneratorDraft;
  activeTab: TabId;
  galleryCellStyles: Record<string, GalleryCellStyle>;
}

export const storageKey = "listing-ai-workspace-records";
export const draftStorageKey = "listing-ai-workspace-draft";
export const galleryCellStylesStorageKey = "listing-ai-gallery-cell-styles";

export const initialInput: ListingOptimizationRequest = {
  marketplace: "US",
  language: "zh-CN",
  tone: "professional",
  submitter: "",
  productChineseName: "",
  productEnglishName: "",
  asin: "",
  brand: "",
  productType: "",
  targetAudience: "",
  useScenarios: "",
  variationInfo: "",
  currentTitle: "",
  currentBullets: "",
  currentDescription: "",
  titleKeywords: "",
  bulletKeywords: "",
  adData: "",
  productFacts: "",
  mainSellingPoint1: "",
  mainSellingPoint2: "",
  mainSellingPoint3: "",
  otherSellingPoints: "",
  material: "",
  dimensions: "",
  packageList: "",
  accessories: "",
  specialStructure: "",
  detailsToAmplify: "",
  competitorInfo: "",
  imageRequirements: "",
  aplusRequirements: "",
};

export function createEmptyCompetitor(): CompetitorDraft {
  return {
    asin: "",
    sales: "",
    price: "",
    variation: "",
    rating: "",
    reviewCount: "",
    mainImage: [],
    screenshot: [],
    title: "",
    bullets: "",
    targetAudience: "",
    useScenarios: "",
    productFeatures: "",
    buyerConcerns: "",
    negativeReviews: "",
    opportunity: "",
    aplus: "",
    images: [],
  };
}

export const initialCompetitors: CompetitorDraft[] = Array.from(
  { length: 3 },
  createEmptyCompetitor,
);

export const titleGeneratorPrompt = `你现在是深耕亚马逊跨境电商5年的资深产品经理，精通亚马逊A9算法、付费广告选词、Listing标题写法，严格按照下面的参考材料和权重优先级进行创作，禁止自由发挥、禁止编造不存在的关键词。

【参考资料】
中文名称、ASIN（仅用于页面记录与历史复盘，不作为标题生成参考）
现有产品标题
我的产品特点
核心广告词
相关关键词整理
广告数据
竞品标题1
竞品标题2
竞品标题3

【模式说明】
老品优化：产品已经在售，优先参考现有产品标题、广告数据和竞品标题，在保留原有搜索意图的前提下优化标题。
新品编写：产品尚未成型或需要重新起标题，优先参考中文名称、产品特点、核心广告词、相关关键词整理和竞品标题，从零生成可上架标题。新品模式下忽略现有产品标题，ASIN 仅作记录，不作为强制输入。

【权重优先级规则（必须严格遵守）】
参考页面输入的权重优先级。
执行硬性约束：
1. 权重数值越高，对应资料的采纳优先级越高；不同信息出现冲突时，直接舍弃低权重内容，以最高权重的信息为准。
2. 如果广告数据权重最高：优先挑选高点击、高转化的真实搜索词根，只借鉴竞品的句式结构，不照搬竞品的具体词汇。
3. 如果竞品权重最高：贴合类目标准语序和埋词逻辑，只把广告里表现好的词适当融入，保证符合平台自然收录规则。
4. 标题严格遵守亚马逊规范：前置核心大词，修饰词后置，不重复堆砌单词，长度适配亚马逊标准标题字符限制。

【输出要求】
只输出3条不同风格的成品标题，分1、2、3罗列，不要多余解释、不要分析文字，不要任何备注。

【模式判定规则】
若广告数据权重 ≥ 70%：广告优先模式，选词全部取自广告出词记录，结构轻度参考竞品。
若竞品标题权重 ≥ 70%：类目模仿模式，句式完全贴合竞品习惯，广告好词少量植入。
其余权重配比：均衡融合模式，合理分配所有信息来源。
如果某一项参考资料为空，自动忽略该条内容，使用剩余高权重的材料生成，不得编造内容补齐。

【标题规范】
• 通用上限：≤200 字符（含空格、标点）
• 移动端仅展示前 70~80 字符，最强差异化卖点必须放在前 80 位
• 大小写：Title Case（实词首字母大写，介词 in/for/with、冠词 a/an/the 小写），禁止全大写
• 标点仅允许英文符号
• 绝对禁止写入其他产品商标词
• 全部内容语义通顺，适配亚马逊 A9 搜索与 Rufus AI 问答抓取，无重复关键词堆砌。
• 针对不同场景尺寸必须从公制转换成美国当地常用尺寸，如 in, oz, lbs 等。`;

export const descriptionGeneratorPrompt = `亚马逊产品描述 AI 生成统一规格
【参考资料】
中文名称、ASIN（仅用于页面记录与历史复盘，不作为五点生成参考）
我的产品特点
核心广告词
相关关键词整理
广告数据
竞品描述1
竞品描述2
竞品描述3 如果有权重说明，则参考，未填入的部分跳过。
## 一、核心执行总则

1. 权重优先级规则
严格遵循输入素材的权重数值，权重越高采纳优先级越高；不同素材信息冲突时，直接舍弃低权重内容，以最高权重信息为准。
可用素材池：核心广告词、相关关键词整理、广告数据、竞品描述 / 五点；空缺素材自动忽略，严禁编造不存在的关键词与卖点。
2. 生成模式判定规则
- 广告优先模式：广告数据权重 ≥ 70%
选词全部取自广告高点击、高转化的真实搜索词根；仅借鉴竞品的卖点排布逻辑与句式结构，不照搬竞品具体词汇。
- 类目模仿模式：竞品描述权重 ≥ 70%
卖点顺序、句式表达完全贴合类目竞品的通用逻辑；仅将广告数据中表现优异的词汇少量、自然融入，符合平台自然收录规则。
- 均衡融合模式：其余权重配比
合理分配所有信息来源，广告好词均匀埋入，竞品结构做参考，全覆盖核心广告词。

## 二、五点描述（Bullet Points）强制规范

### 1. 格式硬性要求

- 固定输出 5 条卖点，单条字符数控制在 150-250 字符，五点总字符≤1000 字符。
- 每条以大写字母核心卖点短语开篇，后跟 1-2 句补充说明；加粗短语采用 Title Case（实词首字母大写），补充说明句首大写、句尾加句号。
- 仅使用英文标点，禁止中文符号、特殊符号与 emoji。
- 单位转换：所有公制单位必须转换为美国市场常用英制单位：长度用 inch/in、重量用 oz/lbs、容积用 fl oz/gal、温度用 °F。
- 绝对禁止写入其他品牌商标词、竞品品牌名。
- 禁止添加外部联系方式、网址、社交媒体账号、其他平台导流信息。
- 禁止虚假承诺、误导性描述。
- 无重复堆砌：同一关键词全文不重复堆砌，核心词自然分布在不同位置。



### 2. 内容排布逻辑（默认优先级，可按类目特性调整）

### 核心逻辑：前置核心卖点，后置细节参数，适配 A9 算法收录、Rufus AI 问答抓取、买家阅读习惯

1. 首段（核心引流，重中之重）
前 2 行聚焦核心功能、核心痛点解决方案、核心差异化优势，植入高权重精准搜索词根，适配平台搜索收录。
2. 中段（产品细节 + 特点落地）
逐条落地产品材质、尺寸、性能、使用场景、适配机型、核心优势，结合优质广告词根自然埋词，不堆砌、不生硬。
3. 末段（附加值 + 信任背书）
补充使用体验、耐用性、通用性、售后适配优势，提升转化，完善内容闭环。

### 3. 埋词规则

- 每点自然埋入 1-2 个高权重词根，全五点尽量覆盖全部核心广告词与 50% 以上高转化广告词。
- 同一词根在五点中出现不超过 2 次，禁止关键词重复堆砌。

## 4. 最终输出要求
- 仅输出英文成品内容，不附带解释、分析、备注等多余文字。
- 生成前自动校验字符数、大小写、单位、合规性四项指标，不符合规则自动修正。
- 全文适配亚马逊 A9 搜索算法、Rufus AI 智能抓取规则。
- 风格自然种草，兼顾搜索引擎收录 + 买家阅读体验，合规且高转化。
- 严格匹配对应权重模式的创作逻辑，不偏离规则。`;

export const titleGeneratorFields: TitleGeneratorField[] = [
  { key: "productChineseName", label: "中文名称", weight: 0, value: "" },
  { key: "asin", label: "ASIN", weight: 0, value: "" },
  { key: "currentProductTitle", label: "现有产品标题", weight: 0, value: "" },
  { key: "productFeatures", label: "我的产品特点", weight: 10, value: "" },
  { key: "coreAdWords", label: "核心广告词", weight: 30, value: "" },
  { key: "relatedKeywords", label: "相关关键词整理", weight: 20, value: "" },
  { key: "adData", label: "广告数据", weight: 10, value: "" },
  { key: "competitorTitle1", label: "竞品标题1", weight: 10, value: "" },
  { key: "competitorTitle2", label: "竞品标题2", weight: 10, value: "" },
  { key: "competitorTitle3", label: "竞品标题3", weight: 10, value: "" },
];

export function createTitleGeneratorModeDraft(
  fields: TitleGeneratorField[] = titleGeneratorFields,
): TitleGeneratorModeDraft {
  return {
    fields: fields.map((field) => ({ ...field })),
    results: [],
    history: [],
  };
}

export const initialTitleGenerator: TitleGeneratorDraft = {
  mode: "old",
  prompt: titleGeneratorPrompt,
  results: [],
  history: [],
  fields: titleGeneratorFields.map((field) => ({ ...field })),
  modes: {
    old: createTitleGeneratorModeDraft(),
    new: createTitleGeneratorModeDraft(),
  },
};

export const descriptionGeneratorFields: DescriptionGeneratorField[] = [
  { key: "competitorDescription1", label: "竞品描述1", weight: 10, value: "" },
  { key: "competitorDescription2", label: "竞品描述2", weight: 10, value: "" },
  { key: "competitorDescription3", label: "竞品描述3", weight: 10, value: "" },
];

export const initialDescriptionGenerator: DescriptionGeneratorDraft = {
  prompt: descriptionGeneratorPrompt,
  results: [],
  history: [],
  fields: descriptionGeneratorFields.map((field) => ({ ...field })),
};

export const imageGeneratorViews: Array<{ key: ImageGeneratorViewKey; label: string }> =
  [
    { key: "front", label: "正视图" },
    { key: "left", label: "左视图" },
    { key: "right", label: "右视图" },
    { key: "back", label: "后视图" },
    { key: "bottom", label: "底视图" },
    { key: "top", label: "顶视图" },
  ];

export const defaultImageGeneratorPrompt = `我将上传：
- 1-6张我的产品多角度实拍图（作为产品主体参考）
- 1张竞品图片（仅作为场景、构图、拍摄角度和营销表达参考）

任务：
请生成一张全新的商业产品图片。

要求：

1. 产品替换：
使用我的产品作为唯一主体，保持我的产品真实外观：
- 保留我的产品形状、尺寸比例、颜色、纹理、材质、结构特点
- 不改变产品设计
- 不添加竞品的品牌标识、文字、Logo、专利结构或独特外观元素

2. 竞品图片参考：
仅参考竞品图片中的：
- 拍摄角度
- 场景氛围
- 光线方向
- 使用方式
- 构图布局
- 商业摄影风格

不要复制：
- 竞品产品外形
- 竞品颜色组合
- 竞品纹理
- 竞品包装
- 竞品Logo
- 竞品独特设计元素

3. 场景替换：
如果竞品图片展示了产品使用场景，请创建类似但原创的场景。

例如：
竞品展示户外钓鱼场景 →
生成我的产品在真实户外钓鱼环境中的使用场景。

竞品展示厨房操作 →
生成我的产品在现代厨房鱼类处理场景中的使用场景。

4. 图片质量：
生成亚马逊高级商业摄影风格：
- 高清真实摄影
- 4K细节
- 自然光
- 专业产品摄影
- 清晰材质纹理
- 真实阴影
- 高端电商视觉效果

5. 产品真实性：
我的产品必须看起来像真实存在的商品：
- 不改变结构
- 不增加不存在的功能
- 不夸大尺寸
- 不产生AI幻觉细节

6. 输出：
生成适用于Amazon主图/副图的商业图片。`;

export const initialImageGenerator: ImageGeneratorDraft = {
  ownViews: {
    front: [],
    left: [],
    right: [],
    back: [],
    bottom: [],
    top: [],
  },
  competitorImages: [],
  prompt: defaultImageGeneratorPrompt,
  generatedImages: [],
  history: [],
  lastRunAt: "",
};

export const fieldClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
export const labelClass = "text-xs font-bold uppercase tracking-normal text-muted";

function stripLocalImages(images: ImagePreview[] | undefined) {
  return Array.isArray(images)
    ? images
        .filter(
          (image) =>
            image.assetId ||
            (image.url &&
              !image.url.startsWith("data:image/") &&
              !image.url.startsWith("blob:")),
        )
        .map((image) =>
          image.assetId ? { ...image, url: "" } : image,
        )
    : [];
}

export function createPersistableDraft(draft: WorkspaceDraft): WorkspaceDraft {
  return {
    ...draft,
    competitors: draft.competitors.map((competitor) => ({
      ...competitor,
      mainImage: stripLocalImages(competitor.mainImage),
      screenshot: stripLocalImages(competitor.screenshot),
      images: stripLocalImages(competitor.images),
    })),
    ownImages: {
      ...draft.ownImages,
      mainImage: stripLocalImages(draft.ownImages.mainImage),
      images: stripLocalImages(draft.ownImages.images),
    },
    imageGenerator: {
      ...draft.imageGenerator,
      ownViews: imageGeneratorViews.reduce(
        (views, view) => ({
          ...views,
          [view.key]: stripLocalImages(draft.imageGenerator.ownViews[view.key]),
        }),
        {} as Record<ImageGeneratorViewKey, ImagePreview[]>,
      ),
      competitorImages: stripLocalImages(draft.imageGenerator.competitorImages),
      generatedImages: stripLocalImages(draft.imageGenerator.generatedImages),
      history: Array.isArray(draft.imageGenerator.history)
        ? draft.imageGenerator.history.map((record) => ({
            ...record,
            images: stripLocalImages(record.images),
          }))
        : [],
    },
  };
}

export function buildCompetitorInfo(competitors: CompetitorDraft[], ownNotes: string) {
  return competitors
    .map((competitor, index) =>
      `
Competitor ${index + 1}
ASIN: ${competitor.asin || "Not provided"}
Amazon URL: ${competitor.asin ? `https://www.amazon.com/dp/${competitor.asin}` : "Not provided"}
Sales: ${competitor.sales || "Not provided"}
Price: ${competitor.price || "Not provided"}
Variations: ${competitor.variation || "Not provided"}
Rating: ${competitor.rating || "Not provided"}
Review count: ${competitor.reviewCount || "Not provided"}
Title: ${competitor.title || "Not provided"}
Bullets: ${competitor.bullets || "Not provided"}
Target audience: ${competitor.targetAudience || "Not provided"}
Use scenarios: ${competitor.useScenarios || "Not provided"}
Product features: ${competitor.productFeatures || "Not provided"}
Buyer concerns: ${competitor.buyerConcerns || "Not provided"}
Negative review issues: ${competitor.negativeReviews || "Not provided"}
Selling point comparison: ${competitor.opportunity || "Not provided"}
A+ reference: ${competitor.aplus || "Not provided"}
Screenshot names: ${competitor.screenshot.map((image) => image.name).join(", ") || "Not provided"}
Main image name: ${competitor.mainImage.map((image) => image.name).join(", ") || "Not provided"}
Uploaded image names: ${competitor.images.map((image) => image.name).join(", ") || "Not provided"}
`.trim(),
    )
    .join("\n\n")
    .concat(`\n\nOur image notes:\n${ownNotes || "Not provided"}`);
}

export function buildImageRequirements(
  baseRequirements: string,
  competitors: CompetitorDraft[],
  ownImages: OwnImageDraft,
) {
  return `
${baseRequirements || "Not provided"}

Competitor uploaded image names:
${competitors.map((competitor, index) => `Competitor ${index + 1}: ${competitor.images.map((image) => image.name).join(", ") || "No images"}`).join("\n")}

Own uploaded image names:
Main image: ${ownImages.mainImage.map((image) => image.name).join(", ") || "No main image"}
${ownImages.images.map((image) => image.name).join(", ") || "No images"}

Image row notes:
${ownImages.imageNotes.map((note, index) => `Image ${index + 1}: ${note || "No note"}`).join("\n") || "Not provided"}

Own image structure notes:
${ownImages.structureNotes || "Not provided"}
`.trim();
}

export function formatCopywriting(result: ListingOptimizationResult) {
  return [
    `产品定位：${result.positioning.oneSentence}`,
    `主卖点：${result.positioning.strongestSellingPoint}`,
    "",
    "标题版本：",
    ...result.titleOptions.map((item) => `${item.type}: ${item.title}`),
    "",
    `推荐标题：${result.title}`,
    "",
    "五点：",
    ...result.bullets.map(
      (item, index) =>
        `${index + 1}. ${item.bullet}\n中文解释：${item.chineseExplanation}\n图片表达：${item.imageExpression}`,
    ),
  ].join("\n");
}

export function formatImages(result: ListingOptimizationResult) {
  return [
    "图片执行表",
    ...result.imagePlan.map(
      (item) =>
        `${item.imageNo} ${item.theme}\n买家想法：${item.buyerTakeaway}\n布局：${item.layout}\n角度：${item.productAngle}\n放大卖点：${item.amplifiedSellingPoint}\n英文文案：${item.englishCopy}\n美工说明：${item.designerInstruction}\n中文提示词：${item.cnPrompt}\n英文提示词：${item.enPrompt}\n负面提示词：${item.negativePrompt}`,
    ),
    "",
    "A+ 页面方案",
    ...result.aplusPlan.map(
      (item) =>
        `${item.moduleNo} ${item.coreMessage}\n布局：${item.layout}\n文案：${item.copy}\n视觉：${item.visualElements}`,
    ),
  ].join("\n\n");
}

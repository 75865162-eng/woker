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

export interface TitleGeneratorField {
  key: TitleGeneratorFieldKey;
  label: string;
  weight: number;
  value: string;
}

export interface TitleGeneratorDraft {
  fields: TitleGeneratorField[];
  prompt: string;
  results: string[];
  history: TitleGeneratorHistoryRecord[];
}

export interface TitleGeneratorHistoryRecord {
  id: string;
  createdAt: string;
  fields: TitleGeneratorField[];
  prompt: string;
  results: string[];
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
  lastRunAt: string;
}

export type TabId = "input" | "visual" | "analysis" | "listing" | "imagePlan" | "review";

export interface WorkspaceDraft {
  input: ListingOptimizationRequest;
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  titleGenerator: TitleGeneratorDraft;
  imageGenerator: ImageGeneratorDraft;
  activeTab: TabId;
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
• 全部内容语义通顺，适配亚马逊 A9 搜索与 Rufus AI 问答抓取，无重复关键词堆砌。`;

export const initialTitleGenerator: TitleGeneratorDraft = {
  prompt: titleGeneratorPrompt,
  results: [],
  history: [],
  fields: [
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
  ],
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

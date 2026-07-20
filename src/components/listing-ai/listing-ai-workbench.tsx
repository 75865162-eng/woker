"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  GripVertical,
  Highlighter,
  History,
  ImageIcon,
  Layers3,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  aiSettingsStorageKey,
  normalizeAiSettings,
  type AiModelSettings,
} from "@/lib/ai-settings";
import {
  blobToDataUrl,
  readListingAiImageAsset,
  saveListingAiImageAsset,
} from "@/lib/listing-ai/image-assets";
import type {
  ListingOptimizationApiRequest,
  ListingOptimizationRequest,
  ListingOptimizationResult,
} from "@/lib/listing-ai/types";

interface CompetitorDraft {
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

interface OwnImageDraft {
  structureNotes: string;
  mainImage: ImagePreview[];
  images: ImagePreview[];
  imageNotes: string[];
  sales: string;
  price: string;
  rating: string;
  reviewCount: string;
}

interface ImagePreview {
  name: string;
  url: string;
  assetId?: string;
}

interface GalleryInfoRow {
  label: string;
  mineValue: string;
  updateMine: (value: string) => void;
  competitorValue: (competitor: CompetitorDraft) => string;
  updateCompetitor: (columnIndex: number, value: string) => void;
  asin?: boolean;
  multiline?: boolean;
  tall?: boolean;
}

interface GalleryCellStyle {
  redText?: boolean;
  yellowBg?: boolean;
  redRanges?: Array<{ start: number; end: number }>;
}

interface GalleryExcelCell {
  value?: unknown;
  font?: { bold?: boolean; color?: { argb?: string } };
  fill?: {
    type?: string;
    pattern?: string;
    fgColor?: { argb?: string };
    bgColor?: { argb?: string };
  };
}

interface SavedRecord {
  id: string;
  version: number;
  createdAt: string;
  submitter: string;
  productName: string;
  input: ListingOptimizationRequest;
  result: ListingOptimizationResult;
}

type TitleGeneratorFieldKey =
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

interface TitleGeneratorField {
  key: TitleGeneratorFieldKey;
  label: string;
  weight: number;
  value: string;
}

interface TitleGeneratorDraft {
  fields: TitleGeneratorField[];
  prompt: string;
  results: string[];
  history: TitleGeneratorHistoryRecord[];
}

interface TitleGeneratorHistoryRecord {
  id: string;
  createdAt: string;
  fields: TitleGeneratorField[];
  prompt: string;
  results: string[];
}

type ImageGeneratorViewKey =
  | "front"
  | "left"
  | "right"
  | "back"
  | "bottom"
  | "top";

interface ImageGeneratorDraft {
  ownViews: Record<ImageGeneratorViewKey, ImagePreview[]>;
  competitorImages: ImagePreview[];
  prompt: string;
  generatedImages: ImagePreview[];
  lastRunAt: string;
}

const storageKey = "listing-ai-workspace-records";
const draftStorageKey = "listing-ai-workspace-draft";
const galleryCellStylesStorageKey = "listing-ai-gallery-cell-styles";

const tabs = [
  { id: "input", label: "Title", icon: Search },
  { id: "visual", label: "Images & A+", icon: ImageIcon },
  { id: "analysis", label: "AI Analysis", icon: BarChart3 },
  { id: "listing", label: "Listing", icon: Sparkles },
  { id: "imagePlan", label: "Image Plan", icon: Layers3 },
  { id: "review", label: "Review & History", icon: History },
] as const;

type TabId = (typeof tabs)[number]["id"];

interface WorkspaceDraft {
  input: ListingOptimizationRequest;
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  titleGenerator: TitleGeneratorDraft;
  imageGenerator: ImageGeneratorDraft;
  activeTab: TabId;
}

const initialInput: ListingOptimizationRequest = {
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

function createEmptyCompetitor(): CompetitorDraft {
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

const initialCompetitors: CompetitorDraft[] = Array.from(
  { length: 3 },
  createEmptyCompetitor,
);

const titleGeneratorPrompt = `你现在是深耕亚马逊跨境电商5年的资深产品经理，精通亚马逊A9算法、付费广告选词、Listing标题写法，严格按照下面的参考材料和权重优先级进行创作，禁止自由发挥、禁止编造不存在的关键词。

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

const initialTitleGenerator: TitleGeneratorDraft = {
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

const imageGeneratorViews: Array<{ key: ImageGeneratorViewKey; label: string }> =
  [
    { key: "front", label: "正视图" },
    { key: "left", label: "左视图" },
    { key: "right", label: "右视图" },
    { key: "back", label: "后视图" },
    { key: "bottom", label: "底视图" },
    { key: "top", label: "顶视图" },
  ];

const defaultImageGeneratorPrompt = `我将上传：
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

const initialImageGenerator: ImageGeneratorDraft = {
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

const fieldClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
const labelClass = "text-xs font-bold uppercase tracking-normal text-muted";

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

function createPersistableDraft(draft: WorkspaceDraft): WorkspaceDraft {
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

async function hydrateImage(image: ImagePreview): Promise<ImagePreview> {
  if (image.url || !image.assetId) {
    return image;
  }

  try {
    const asset = await readListingAiImageAsset(image.assetId);
    if (!asset) {
      return image;
    }

    return {
      ...image,
      name: image.name || asset.name,
      url: await blobToDataUrl(asset.blob),
    };
  } catch (storageError) {
    console.warn("Failed to restore Listing AI image.", storageError);
    return image;
  }
}

async function hydrateImages(images: ImagePreview[] | undefined) {
  const hydratedImages = await Promise.all(
    (Array.isArray(images) ? images : []).map(hydrateImage),
  );

  return hydratedImages.filter((image) => image.url);
}

async function hydrateCompetitorDraft(competitor: CompetitorDraft) {
  return {
    ...competitor,
    mainImage: await hydrateImages(competitor.mainImage),
    screenshot: await hydrateImages(competitor.screenshot),
    images: await hydrateImages(competitor.images),
  };
}

async function hydrateOwnImageDraft(ownImages: OwnImageDraft) {
  return {
    ...ownImages,
    mainImage: await hydrateImages(ownImages.mainImage),
    images: await hydrateImages(ownImages.images),
  };
}

async function hydrateImageGeneratorDraft(draft: ImageGeneratorDraft) {
  const ownViews = { ...initialImageGenerator.ownViews };

  await Promise.all(
    imageGeneratorViews.map(async (view) => {
      ownViews[view.key] = await hydrateImages(draft.ownViews[view.key]);
    }),
  );

  return {
    ...draft,
    ownViews,
    competitorImages: await hydrateImages(draft.competitorImages),
    generatedImages: await hydrateImages(draft.generatedImages),
  };
}

export function ListingAiWorkbench() {
  const [activeTab, setActiveTab] = useState<TabId>("input");
  const [input, setInput] = useState(initialInput);
  const [competitors, setCompetitors] =
    useState<CompetitorDraft[]>(initialCompetitors);
  const [ownImages, setOwnImages] = useState<OwnImageDraft>({
    structureNotes: "",
    mainImage: [],
    images: [],
    imageNotes: [],
    sales: "",
    price: "",
    rating: "",
    reviewCount: "",
  });
  const [titleGenerator, setTitleGenerator] = useState<TitleGeneratorDraft>(
    initialTitleGenerator,
  );
  const [imageGenerator, setImageGenerator] = useState<ImageGeneratorDraft>(
    initialImageGenerator,
  );
  const [titlePromptOpen, setTitlePromptOpen] = useState(false);
  const [titleGenerating, setTitleGenerating] = useState(false);
  const [titleGeneratorError, setTitleGeneratorError] = useState("");
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageGeneratorError, setImageGeneratorError] = useState("");
  const [result, setResult] = useState<ListingOptimizationResult | null>(null);
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreDraft() {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved && !cancelled) setRecords(JSON.parse(saved) as SavedRecord[]);

        const draft = window.localStorage.getItem(draftStorageKey);
        if (draft) {
          const parsed = JSON.parse(draft) as Partial<WorkspaceDraft>;
          if (parsed.input && !cancelled) setInput({ ...initialInput, ...parsed.input });
          if (parsed.competitors) {
            const restoredCompetitors = await Promise.all(
              initialCompetitors.map((emptyCompetitor, index) =>
                hydrateCompetitorDraft({
                  ...emptyCompetitor,
                  ...parsed.competitors?.[index],
                }),
              ),
            );
            if (!cancelled) setCompetitors(restoredCompetitors);
          }
          if (parsed.ownImages) {
            const emptyOwnImages: OwnImageDraft = {
              structureNotes: "",
              mainImage: [],
              images: [],
              imageNotes: [],
              sales: "",
              price: "",
              rating: "",
              reviewCount: "",
            };
            const restoredOwnImages = await hydrateOwnImageDraft({
              ...emptyOwnImages,
              ...parsed.ownImages,
            });
            if (!cancelled) setOwnImages(restoredOwnImages);
          }
          if (parsed.titleGenerator && !cancelled) {
            setTitleGenerator({
              ...initialTitleGenerator,
              ...parsed.titleGenerator,
              fields: initialTitleGenerator.fields.map((field) => ({
                ...field,
                ...parsed.titleGenerator?.fields?.find(
                  (savedField) => savedField.key === field.key,
                ),
              })),
              history: Array.isArray(parsed.titleGenerator.history)
                ? parsed.titleGenerator.history
                : [],
            });
          }
          if (parsed.imageGenerator) {
            const restoredImageGenerator = await hydrateImageGeneratorDraft({
              ...initialImageGenerator,
              ...parsed.imageGenerator,
              ownViews: {
                ...initialImageGenerator.ownViews,
                ...parsed.imageGenerator.ownViews,
              },
              competitorImages: Array.isArray(
                parsed.imageGenerator.competitorImages,
              )
                ? parsed.imageGenerator.competitorImages
                : [],
              generatedImages: Array.isArray(parsed.imageGenerator.generatedImages)
                ? parsed.imageGenerator.generatedImages
                : [],
              prompt: parsed.imageGenerator.prompt?.trim()
                ? parsed.imageGenerator.prompt
                : defaultImageGeneratorPrompt,
            });
            if (!cancelled) setImageGenerator(restoredImageGenerator);
          }
          if (parsed.activeTab && !cancelled) setActiveTab(parsed.activeTab);
        }
      } catch (storageError) {
        console.warn("Failed to restore Listing AI draft.", storageError);
        window.localStorage.removeItem(draftStorageKey);
      } finally {
        if (!cancelled) setDraftReady(true);
      }
    }

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const draft: WorkspaceDraft = {
      input,
      competitors,
      ownImages,
      titleGenerator,
      imageGenerator,
      activeTab,
    };
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify(createPersistableDraft(draft)),
      );
    } catch (storageError) {
      console.warn("Failed to persist Listing AI draft.", storageError);
      window.localStorage.removeItem(draftStorageKey);
    }
  }, [
    activeTab,
    competitors,
    draftReady,
    imageGenerator,
    input,
    ownImages,
    titleGenerator,
  ]);

  const productName =
    input.asin ||
    input.productEnglishName ||
    input.productChineseName ||
    "Untitled Product";
  const productFactsCount = input.productFacts.trim().length;
  const canSubmit =
    input.asin.trim().length > 1 && productFactsCount >= 50 && !loading;
  const latestVersion =
    records.find((record) => record.productName === productName)?.version ?? 0;
  const competitorImageCount = competitors.reduce(
    (total, competitor) => total + competitor.images.length,
    0,
  );
  const ownImageCount = ownImages.images.length;
  const competitorInfo = useMemo(
    () => buildCompetitorInfo(competitors, ownImages.structureNotes),
    [competitors, ownImages.structureNotes],
  );
  const imageRequirements = useMemo(
    () =>
      buildImageRequirements(input.imageRequirements, competitors, ownImages),
    [input.imageRequirements, competitors, ownImages],
  );

  function update<K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  function handleImageUpload(
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) {
    const selected = Array.from(files ?? []).slice(0, 12);
    Promise.all(
      selected.map(async (file) => {
        try {
          const asset = await saveListingAiImageAsset(file);
          return {
            name: asset.name,
            url: await blobToDataUrl(asset.blob),
            assetId: asset.id,
          };
        } catch (storageError) {
          console.warn("Failed to save Listing AI image asset.", storageError);
          return new Promise<ImagePreview>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: file.name, url: String(reader.result || "") });
            reader.onerror = () =>
              resolve({ name: file.name, url: URL.createObjectURL(file) });
            reader.readAsDataURL(file);
          });
        }
      }),
    ).then(callback);
  }

  function updateTitleGeneratorField(
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) {
    setTitleGenerator((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    }));
  }

  function loadTitleGeneratorHistory(record: TitleGeneratorHistoryRecord) {
    setTitleGenerator((current) => ({
      ...current,
      fields: initialTitleGenerator.fields.map((field) => ({
        ...field,
        ...record.fields.find((savedField) => savedField.key === field.key),
      })),
      prompt: record.prompt,
      results: record.results,
    }));
    setTitleGeneratorError("");
  }

  async function handleGenerateTitles() {
    setTitleGenerating(true);
    setTitleGeneratorError("");

    const savedAiSettings = window.localStorage.getItem(aiSettingsStorageKey);
    const aiSettings = savedAiSettings
      ? normalizeAiSettings(
          JSON.parse(savedAiSettings) as Partial<AiModelSettings>,
        )
      : null;

    if (!aiSettings?.apiKey.trim()) {
      setTitleGeneratorError("请先到 Settings 保存 AI 大模型 API Key。");
      setTitleGenerating(false);
      return;
    }

    try {
      const response = await fetch("/api/listing-ai/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...titleGenerator, aiSettings }),
      });
      const data = (await response.json()) as {
        results?: string[];
        error?: string;
      };

      if (!response.ok || !data.results?.length)
        throw new Error(data.error || "标题生成失败");

      const nextResults = data.results!.slice(0, 3);
      setTitleGenerator((current) => {
        const record: TitleGeneratorHistoryRecord = {
          id: crypto.randomUUID(),
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          fields: current.fields.map((field) => ({ ...field })),
          prompt: current.prompt,
          results: nextResults,
        };

        return {
          ...current,
          results: nextResults,
          history: [record, ...current.history].slice(0, 30),
        };
      });
    } catch (err) {
      setTitleGeneratorError(
        err instanceof Error ? err.message : "标题生成失败",
      );
    } finally {
      setTitleGenerating(false);
    }
  }

  async function handleOptimize() {
    setLoading(true);
    setError("");

    const savedAiSettings = window.localStorage.getItem(aiSettingsStorageKey);
    const aiSettings = savedAiSettings
      ? normalizeAiSettings(
          JSON.parse(savedAiSettings) as Partial<AiModelSettings>,
        )
      : null;

    if (!aiSettings?.apiKey.trim()) {
      setError("请先到 Settings 保存 AI 大模型 API Key。");
      setLoading(false);
      return;
    }

    const payload: ListingOptimizationRequest = {
      ...input,
      productType: input.productType || input.productEnglishName || input.asin,
      competitorInfo,
      imageRequirements,
    };

    try {
      const response = await fetch("/api/listing-ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          aiSettings,
        } satisfies ListingOptimizationApiRequest),
      });
      const data = (await response.json()) as {
        result?: ListingOptimizationResult;
        error?: string;
      };

      if (!response.ok || !data.result)
        throw new Error(data.error || "AI 优化失败");

      setResult(data.result);
      saveRecord(payload, data.result);
      setActiveTab("analysis");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 优化失败");
    } finally {
      setLoading(false);
    }
  }

  function saveRecord(
    payload: ListingOptimizationRequest,
    nextResult: ListingOptimizationResult,
  ) {
    const version =
      (records.filter((record) => record.productName === productName).length ||
        0) + 1;
    const record: SavedRecord = {
      id: crypto.randomUUID(),
      version,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      submitter: payload.submitter || "未填写",
      productName:
        payload.asin ||
        payload.productEnglishName ||
        payload.productChineseName ||
        payload.productType ||
        "未命名产品",
      input: payload,
      result: nextResult,
    };
    const nextRecords = [record, ...records].slice(0, 50);
    setRecords(nextRecords);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextRecords));
    } catch (storageError) {
      console.warn("Failed to persist Listing AI history.", storageError);
    }
  }

  function loadRecord(record: SavedRecord) {
    setInput(record.input);
    setResult(record.result);
    setActiveTab("analysis");
    setError("");
  }

  function resetDraft() {
    setInput(initialInput);
    setCompetitors(initialCompetitors);
    setOwnImages({
      structureNotes: "",
      mainImage: [],
      images: [],
      imageNotes: [],
      sales: "",
      price: "",
      rating: "",
      reviewCount: "",
    });
    setTitleGenerator(initialTitleGenerator);
    setImageGenerator(initialImageGenerator);
    setTitleGeneratorError("");
    setImageGeneratorError("");
    setResult(null);
    setActiveTab("input");
    setError("");
    window.localStorage.removeItem(draftStorageKey);
  }

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  }

  async function handleRunImageGenerator() {
    const viewCount = imageGeneratorViews.reduce(
      (total, view) => total + imageGenerator.ownViews[view.key].length,
      0,
    );
    if (
      !viewCount ||
      !imageGenerator.competitorImages.length ||
      !imageGenerator.prompt.trim()
    ) {
      setImageGeneratorError("请先上传六视图、竞品图，并填写提示词。");
      return;
    }

    const savedAiSettings = window.localStorage.getItem(aiSettingsStorageKey);
    const aiSettings = savedAiSettings
      ? normalizeAiSettings(
          JSON.parse(savedAiSettings) as Partial<AiModelSettings>,
        )
      : null;

    if (!aiSettings?.apiKey.trim()) {
      setImageGeneratorError("请先到 Settings 保存可用于图片生成的大模型 API Key。");
      return;
    }

    setImageGenerating(true);
    setImageGeneratorError("");

    try {
      const response = await fetch("/api/listing-ai/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...imageGenerator, aiSettings }),
      });
      const data = (await response.json()) as {
        images?: ImagePreview[];
        error?: string;
      };

      if (!response.ok || !data.images?.length) {
        throw new Error(data.error || "图片生成失败，请检查模型是否支持图片生成。");
      }

      setImageGenerator((current) => ({
        ...current,
        generatedImages: [...data.images!, ...current.generatedImages].slice(
          0,
          12,
        ),
        lastRunAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      }));
    } catch (error) {
      setImageGeneratorError(
        error instanceof Error ? error.message : "图片生成失败，请稍后重试。",
      );
    } finally {
      setImageGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_520px]">
          <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">Listing Optimization Workspace</Badge>
              <Badge tone="green">Autosaved</Badge>
              <Badge tone="amber">Version {latestVersion || 1}</Badge>
              <Button size="sm" variant="secondary" onClick={resetDraft}>
                <RotateCcw className="h-4 w-4" />
                一键撤销输入
              </Button>
            </div>
            <h2 className="mt-4 text-2xl font-black leading-tight text-foreground md:text-3xl">
              {productName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              一个工作区管理产品信息、竞品、图片图库、AI 分析、Listing、Image
              Plan、A+、AI Review 和历史版本。
            </p>
          </div>
          <div className="grid grid-cols-4 divide-x divide-border">
            <WorkspaceMetric label="Facts" value={`${productFactsCount}/50`} />
            <WorkspaceMetric
              label="Competitor Images"
              value={`${competitorImageCount}`}
            />
            <WorkspaceMetric label="Mine" value={`${ownImageCount}`} />
            <WorkspaceMetric
              label="AI Score"
              value={result ? `${result.score}` : "--"}
            />
          </div>
        </div>
      </section>

      <Card>
        <CardContent className="overflow-x-auto p-2">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`flex h-10 items-center gap-2 rounded-md px-4 text-sm font-bold transition ${
                    active
                      ? "bg-brand text-white"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <main>
        {activeTab === "input" ? (
          <InputCompetitorsSection
            productFactsCount={productFactsCount}
            titleGenerator={titleGenerator}
            titleGenerating={titleGenerating}
            titleGeneratorError={titleGeneratorError}
            titlePromptOpen={titlePromptOpen}
            updateTitleGeneratorField={updateTitleGeneratorField}
            setTitleGenerator={setTitleGenerator}
            setTitlePromptOpen={setTitlePromptOpen}
            onGenerateTitles={handleGenerateTitles}
            onLoadTitleGeneratorHistory={loadTitleGeneratorHistory}
          />
        ) : null}
        {activeTab === "visual" ? (
          <VisualAplusSection
            competitors={competitors}
            ownImages={ownImages}
            setCompetitors={setCompetitors}
            setOwnImages={setOwnImages}
            input={input}
            update={update}
            error={error}
            canSubmit={canSubmit}
            loading={loading}
            onGenerate={handleOptimize}
            result={result}
            handleImageUpload={handleImageUpload}
          />
        ) : null}
        {activeTab === "analysis" ? (
          <AnalysisSection
            result={result}
            loading={loading}
            error={error}
            canSubmit={canSubmit}
            onGenerate={handleOptimize}
          />
        ) : null}
        {activeTab === "listing" ? (
          <ListingSection result={result} copied={copied} copyText={copyText} />
        ) : null}
        {activeTab === "imagePlan" ? (
          <ImagePlanSection
            result={result}
            copied={copied}
            copyText={copyText}
            imageGenerator={imageGenerator}
            imageGenerating={imageGenerating}
            imageGeneratorError={imageGeneratorError}
            setImageGenerator={setImageGenerator}
            handleImageUpload={handleImageUpload}
            onRunImageGenerator={handleRunImageGenerator}
          />
        ) : null}
        {activeTab === "review" ? (
          <ReviewHistorySection
            result={result}
            records={records}
            onLoad={loadRecord}
          />
        ) : null}
      </main>
    </div>
  );
}

function InputCompetitorsSection({
  productFactsCount,
  titleGenerator,
  titleGenerating,
  titleGeneratorError,
  titlePromptOpen,
  updateTitleGeneratorField,
  setTitleGenerator,
  setTitlePromptOpen,
  onGenerateTitles,
  onLoadTitleGeneratorHistory,
}: {
  productFactsCount: number;
  titleGenerator: TitleGeneratorDraft;
  titleGenerating: boolean;
  titleGeneratorError: string;
  titlePromptOpen: boolean;
  updateTitleGeneratorField: (
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) => void;
  setTitleGenerator: React.Dispatch<React.SetStateAction<TitleGeneratorDraft>>;
  setTitlePromptOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onGenerateTitles: () => void;
  onLoadTitleGeneratorHistory: (record: TitleGeneratorHistoryRecord) => void;
}) {
  return (
    <div className="space-y-3">
      <TitleGeneratorCard
        generator={titleGenerator}
        loading={titleGenerating}
        error={titleGeneratorError}
        promptOpen={titlePromptOpen}
        productFactsCount={productFactsCount}
        onFieldChange={updateTitleGeneratorField}
        onGeneratorChange={setTitleGenerator}
        onPromptOpenChange={setTitlePromptOpen}
        onGenerate={onGenerateTitles}
        onLoadHistory={onLoadTitleGeneratorHistory}
      />
    </div>
  );
}

function TitleGeneratorCard({
  generator,
  loading,
  error,
  promptOpen,
  productFactsCount,
  onFieldChange,
  onGeneratorChange,
  onPromptOpenChange,
  onGenerate,
  onLoadHistory,
}: {
  generator: TitleGeneratorDraft;
  loading: boolean;
  error: string;
  promptOpen: boolean;
  productFactsCount: number;
  onFieldChange: (
    key: TitleGeneratorFieldKey,
    patch: Partial<Pick<TitleGeneratorField, "value" | "weight">>,
  ) => void;
  onGeneratorChange: React.Dispatch<React.SetStateAction<TitleGeneratorDraft>>;
  onPromptOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  onGenerate: () => void;
  onLoadHistory: (record: TitleGeneratorHistoryRecord) => void;
}) {
  const [historySearch, setHistorySearch] = useState("");
  const identityFieldKeys: TitleGeneratorFieldKey[] = [
    "productChineseName",
    "asin",
  ];
  const identityFields = identityFieldKeys
    .map((key) => generator.fields.find((field) => field.key === key))
    .filter((field): field is TitleGeneratorField => Boolean(field));
  const referenceFields = generator.fields.filter(
    (field) => !identityFieldKeys.includes(field.key),
  );
  const totalWeight = referenceFields.reduce(
    (total, field) => total + field.weight,
    0,
  );
  const hasRequiredIdentity = identityFields.every((field) =>
    field.value.trim(),
  );
  const canGenerate =
    hasRequiredIdentity &&
    referenceFields.some((field) => field.value.trim()) &&
    !loading;
  const history = generator.history ?? [];
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const visibleHistory = normalizedHistorySearch
    ? history.filter((record) =>
        [
          record.createdAt,
          record.prompt,
          ...record.results,
          ...record.fields.flatMap((field) => [
            field.label,
            field.value,
            String(field.weight),
          ]),
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedHistorySearch),
      )
    : history;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>标题生成器</CardTitle>
            <p className="mt-1 text-xs font-semibold text-muted">
              按参考资料与权重生成 3 条亚马逊标题。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={totalWeight === 100 ? "green" : "amber"}>
              权重 {totalWeight}%
            </Badge>
            <Badge tone={productFactsCount >= 50 ? "green" : "amber"}>
              Mine Facts {productFactsCount}/50
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onPromptOpenChange(true)}
            >
              <Settings2 className="h-4 w-4" />
              提示词修改
            </Button>
            <Button size="sm" disabled={!canGenerate} onClick={onGenerate}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              AI 生成
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className={labelClass}>产品信息</p>
              <Badge tone={hasRequiredIdentity ? "green" : "amber"}>必填</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {identityFields.map((field) => (
                <label key={field.key} className="space-y-1">
                  <span className="text-xs font-bold text-muted">
                    {field.label}
                  </span>
                  <input
                    className={fieldClass}
                    value={field.value}
                    onChange={(event) =>
                      onFieldChange(field.key, {
                        value:
                          field.key === "asin"
                            ? event.target.value.trim()
                            : event.target.value,
                      })
                    }
                    placeholder={`${field.label}：必填`}
                  />
                </label>
              ))}
            </div>
          </div>
          {referenceFields.map((field) => (
            <div
              key={field.key}
              className="rounded-md border border-border bg-white p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className={labelClass}>{field.label}</p>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`${field.label} 权重`}
                    className="h-8 w-16 rounded-md border border-border bg-white px-2 text-right text-sm font-bold text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                    max={100}
                    min={0}
                    type="number"
                    value={field.weight}
                    onChange={(event) =>
                      onFieldChange(field.key, {
                        weight: Math.max(
                          0,
                          Math.min(100, Number(event.target.value) || 0),
                        ),
                      })
                    }
                  />
                  <span className="text-xs font-bold text-muted">%</span>
                </div>
              </div>
              <textarea
                className={`${fieldClass} h-24 resize-none`}
                value={field.value}
                onChange={(event) =>
                  onFieldChange(field.key, { value: event.target.value })
                }
                placeholder={`${field.label}：输入框`}
              />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-surface-muted/50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className={labelClass}>生成的内容</p>
              <Badge tone={generator.results.length === 3 ? "green" : "gray"}>
                {generator.results.length}/3
              </Badge>
            </div>
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="min-h-24 rounded-md border border-border bg-white p-3"
                >
                  <p className="text-xs font-black text-brand">
                    生成结果{index + 1}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-foreground">
                    {generator.results[index] || "等待生成"}
                  </p>
                </div>
              ))}
            </div>
            {error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </div>
            ) : null}
          </div>
          <div className="rounded-md border border-border bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className={labelClass}>生成历史</p>
              <Badge tone={visibleHistory.length ? "blue" : "gray"}>
                {normalizedHistorySearch
                  ? `${visibleHistory.length}/${history.length}`
                  : history.length}
              </Badge>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className={`${fieldClass} pl-9`}
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="搜索历史名称、ASIN、单词、数据"
              />
            </div>
            {history.length ? (
              visibleHistory.length ? (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {visibleHistory.map((record) => {
                    const recordChineseName = record.fields
                      .find((field) => field.key === "productChineseName")
                      ?.value.trim();
                    const recordAsin = record.fields
                      .find((field) => field.key === "asin")
                      ?.value.trim();
                    const reviewMeta = [recordChineseName, recordAsin]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <div
                        key={record.id}
                        className="rounded-md border border-border bg-surface-muted/40 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-muted">
                            {record.createdAt}
                            {reviewMeta ? ` · ${reviewMeta}` : ""}
                          </p>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onLoadHistory(record)}
                          >
                            复用
                          </Button>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-foreground">
                          {record.results[0] || "无结果"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
                  没有匹配的历史记录
                </div>
              )
            ) : (
              <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
                暂无历史
              </div>
            )}
          </div>
        </div>
      </CardContent>
      {promptOpen ? (
        <PromptEditorDialog
          prompt={generator.prompt}
          onChange={(prompt) =>
            onGeneratorChange((current) => ({ ...current, prompt }))
          }
          onClose={() => onPromptOpenChange(false)}
          onSave={() => onPromptOpenChange(false)}
        />
      ) : null}
    </Card>
  );
}

function PromptEditorDialog({
  prompt,
  onChange,
  onClose,
  onSave,
}: {
  prompt: string;
  onChange: (prompt: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-3xl rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-foreground">提示词修改</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              保存后会作为标题生成器的系统提示词使用。
            </p>
          </div>
          <button
            className="rounded-md p-2 text-muted hover:bg-surface-muted hover:text-foreground"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <textarea
            className={`${fieldClass} h-[420px] resize-none font-mono text-xs leading-5`}
            value={prompt}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSave}>
            <Save className="h-4 w-4" />
            保存提示词
          </Button>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CompetitorsSection({
  competitors,
  ownImages,
  input,
  update,
  updateCompetitor,
  setOwnImages,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  updateCompetitor: (index: number, patch: Partial<CompetitorDraft>) => void;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Competitor Dashboard</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="grid min-w-[1040px] grid-cols-4 gap-4">
          <MineColumn
            input={input}
            ownImages={ownImages}
            update={update}
            setOwnImages={setOwnImages}
            onImagesUpload={(files) =>
              handleImageUpload(files, (images) =>
                setOwnImages((current) => ({ ...current, images })),
              )
            }
          />

          {competitors.map((competitor, index) => (
            <CompetitorColumn
              key={index}
              label={`Competitor ${index + 1}`}
              asin={competitor.asin}
              mainImage={competitor.mainImage}
              title={competitor.title}
              bullets={competitor.bullets}
              targetAudience={competitor.targetAudience}
              useScenarios={competitor.useScenarios}
              productFeatures={competitor.productFeatures}
              opportunity={competitor.opportunity}
              screenshot={competitor.screenshot}
              images={competitor.images}
              onAsinChange={(value) => updateCompetitor(index, { asin: value })}
              onMainImageUpload={(files) =>
                handleImageUpload(files, (images) =>
                  updateCompetitor(index, { mainImage: images.slice(0, 1) }),
                )
              }
              onTitleChange={(value) =>
                updateCompetitor(index, { title: value })
              }
              onBulletsChange={(value) =>
                updateCompetitor(index, { bullets: value })
              }
              onTargetAudienceChange={(value) =>
                updateCompetitor(index, { targetAudience: value })
              }
              onUseScenariosChange={(value) =>
                updateCompetitor(index, { useScenarios: value })
              }
              onProductFeaturesChange={(value) =>
                updateCompetitor(index, { productFeatures: value })
              }
              onOpportunityChange={(value) =>
                updateCompetitor(index, { opportunity: value })
              }
              onScreenshotUpload={(files) =>
                handleImageUpload(files, (images) =>
                  updateCompetitor(index, { screenshot: images.slice(0, 1) }),
                )
              }
              onImagesUpload={(files) =>
                handleImageUpload(files, (images) =>
                  updateCompetitor(index, { images }),
                )
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ImagesSection({
  competitors,
  ownImages,
  setCompetitors,
  setOwnImages,
  input,
  update,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [draggedImage, setDraggedImage] = useState<{
    column: "mine" | "competitor";
    columnIndex: number;
    imageIndex: number;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelError, setExcelError] = useState("");
  const [excelNotice, setExcelNotice] = useState("");
  const [focusedCellKey, setFocusedCellKey] = useState("");
  const [cellStyles, setCellStyles] = useState<Record<string, GalleryCellStyle>>({});
  const selectedTextRangeRef = useRef<{
    styleKey: string;
    range: { start: number; end: number };
  } | null>(null);
  const maxRows = Math.max(
    8,
    ...competitors.map((item) => item.images.length),
    ownImages.images.length,
  );
  const competitorColumns = competitors.map((competitor, index) => ({
    key: `competitor-${index}`,
    type: "competitor" as const,
    label: `Competitor ${index + 1}`,
    images: competitor.images,
    index,
  }));
  const mineColumn = {
    key: "mine",
    type: "mine" as const,
    label: "Mine",
    images: ownImages.images,
    index: -1,
  };
  const imageColumns = [...competitorColumns, mineColumn];
  const tableWidth = 144 + competitorColumns.length * 260 + 260;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(galleryCellStylesStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, GalleryCellStyle>;
      if (parsed && typeof parsed === "object") setCellStyles(parsed);
    } catch {
      window.localStorage.removeItem(galleryCellStylesStorageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(galleryCellStylesStorageKey, JSON.stringify(cellStyles));
  }, [cellStyles]);

  function galleryCellKey(rowLabel: string, columnKey: string) {
    return `${rowLabel}::${columnKey}`;
  }

  function toggleFocusedCellStyle(styleKey: keyof GalleryCellStyle) {
    if (!focusedCellKey) return;
    setCellStyles((current) => {
      const currentStyle = current[focusedCellKey] ?? {};
      const nextStyle = { ...currentStyle, [styleKey]: !currentStyle[styleKey] };
      const next = { ...current };
      if (!nextStyle.redText && !nextStyle.yellowBg && !nextStyle.redRanges?.length) {
        delete next[focusedCellKey];
      } else {
        next[focusedCellKey] = nextStyle;
      }
      return next;
    });
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }

  function normalizedRedRanges(value: string, styleKey?: string) {
    const ranges = styleKey ? (cellStyles[styleKey]?.redRanges ?? []) : [];
    return ranges
      .map((range) => ({
        start: Math.max(0, Math.min(value.length, range.start)),
        end: Math.max(0, Math.min(value.length, range.end)),
      }))
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start);
  }

  function richCellHtml(value: string, styleKey?: string) {
    const ranges = normalizedRedRanges(value, styleKey);
    if (!ranges.length) return escapeHtml(value);

    const parts: string[] = [];
    let cursor = 0;
    ranges.forEach((range) => {
      const start = Math.max(cursor, range.start);
      const end = Math.max(start, range.end);
      if (start > cursor) parts.push(escapeHtml(value.slice(cursor, start)));
      parts.push(
        `<span class="font-bold text-red-700">${escapeHtml(value.slice(start, end))}</span>`,
      );
      cursor = end;
    });
    if (cursor < value.length) parts.push(escapeHtml(value.slice(cursor)));
    return parts.join("");
  }

  function selectedRangeInFocusedCell() {
    if (!focusedCellKey) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const editor = document.querySelector(
      `[data-gallery-cell-key="${CSS.escape(focusedCellKey)}"]`,
    );
    if (!editor) return null;
    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return null;
    }

    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(editor);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(editor);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const start = beforeStart.toString().length;
    const end = beforeEnd.toString().length;
    return end > start ? { start, end } : null;
  }

  function markSelectedTextRed() {
    const selectedRange =
      selectedRangeInFocusedCell() ??
      (selectedTextRangeRef.current?.styleKey === focusedCellKey
        ? selectedTextRangeRef.current.range
        : null);
    if (!selectedRange) {
      toggleFocusedCellStyle("redText");
      return;
    }
    setCellStyles((current) => {
      const currentStyle = current[focusedCellKey] ?? {};
      return {
        ...current,
        [focusedCellKey]: {
          ...currentStyle,
          redRanges: [...(currentStyle.redRanges ?? []), selectedRange],
        },
      };
    });
    selectedTextRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function styleClasses(styleKey?: string) {
    const style = styleKey ? cellStyles[styleKey] : undefined;
    return [
      style?.redText ? "text-red-700 font-bold" : "text-foreground",
      style?.yellowBg ? "bg-yellow-100" : "bg-white",
    ].join(" ");
  }

  function applyGalleryCellStyleToExcelCell(cell: GalleryExcelCell, styleKey: string) {
    const style = cellStyles[styleKey];
    if (!style) return;
    if (style.redText) {
      cell.font = {
        ...(cell.font ?? {}),
        bold: true,
        color: { argb: "FFFF0000" },
      };
    }
    if (style.yellowBg) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" },
      };
    }
  }

  function setExcelCellText(cell: GalleryExcelCell, value: string, styleKey: string) {
    const ranges = normalizedRedRanges(value, styleKey);
    if (!ranges.length) {
      cell.value = value;
      return;
    }

    const richText: Array<{ text: string; font?: { bold?: boolean; color?: { argb: string } } }> =
      [];
    let cursor = 0;
    ranges.forEach((range) => {
      const start = Math.max(cursor, range.start);
      const end = Math.max(start, range.end);
      if (start > cursor) richText.push({ text: value.slice(cursor, start) });
      richText.push({
        text: value.slice(start, end),
        font: { bold: true, color: { argb: "FFFF0000" } },
      });
      cursor = end;
    });
    if (cursor < value.length) richText.push({ text: value.slice(cursor) });
    cell.value = { richText };
  }

  function excelCellStyleToGalleryStyle(cell: GalleryExcelCell) {
    const fontColor = cell.font?.color?.argb?.toUpperCase() ?? "";
    const fillColor = (
      cell.fill?.fgColor?.argb ??
      cell.fill?.bgColor?.argb ??
      ""
    ).toUpperCase();
    const style: GalleryCellStyle = {};
    if (fontColor.endsWith("FF0000")) style.redText = true;
    if (fillColor.endsWith("FFFF00")) style.yellowBg = true;
    const value = cell.value as { richText?: Array<{ text?: string; font?: { color?: { argb?: string } } }> };
    if (Array.isArray(value?.richText)) {
      let cursor = 0;
      const redRanges: Array<{ start: number; end: number }> = [];
      value.richText.forEach((part) => {
        const text = part.text ?? "";
        const start = cursor;
        const end = start + text.length;
        const partColor = part.font?.color?.argb?.toUpperCase() ?? "";
        if (partColor.endsWith("FF0000") && end > start) redRanges.push({ start, end });
        cursor = end;
      });
      if (redRanges.length) style.redRanges = redRanges;
    }
    return style;
  }

  function mergeCellStyle(
    target: Record<string, GalleryCellStyle>,
    styleKey: string,
    style: GalleryCellStyle,
  ) {
    if (!style.redText && !style.yellowBg) return;
    target[styleKey] = { ...(target[styleKey] ?? {}), ...style };
  }

  function setColumnImages(
    type: "mine" | "competitor",
    columnIndex: number,
    images: ImagePreview[],
  ) {
    if (type === "mine") {
      setOwnImages((current) => ({ ...current, images }));
      return;
    }

    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex ? { ...competitor, images } : competitor,
      ),
    );
  }

  function moveImage(
    type: "mine" | "competitor",
    columnIndex: number,
    fromIndex: number,
    toIndex: number,
  ) {
    const column = imageColumns.find(
      (item) => item.type === type && item.index === columnIndex,
    );
    if (!column || toIndex < 0 || toIndex >= column.images.length) {
      return;
    }

    const nextImages = [...column.images];
    const [movedImage] = nextImages.splice(fromIndex, 1);
    if (!movedImage) {
      return;
    }
    nextImages.splice(toIndex, 0, movedImage);
    setColumnImages(type, columnIndex, nextImages);
  }

  function handleDrop(
    type: "mine" | "competitor",
    columnIndex: number,
    targetIndex: number,
  ) {
    if (
      !draggedImage ||
      draggedImage.column !== type ||
      draggedImage.columnIndex !== columnIndex
    ) {
      setDraggedImage(null);
      return;
    }

    moveImage(type, columnIndex, draggedImage.imageIndex, targetIndex);
    setDraggedImage(null);
  }

  function addCompetitorColumn() {
    setCompetitors((current) => [...current, createEmptyCompetitor()]);
  }

  function removeCompetitorColumn() {
    setCompetitors((current) =>
      current.length > 1 ? current.slice(0, current.length - 1) : current,
    );
  }

  function updateImageNote(index: number, value: string) {
    setOwnImages((current) => {
      const imageNotes = [...(current.imageNotes ?? [])];
      imageNotes[index] = value;
      return { ...current, imageNotes };
    });
  }

  function updateOwnImagesField(
    key: keyof Pick<OwnImageDraft, "sales" | "price" | "rating" | "reviewCount">,
    value: string,
  ) {
    setOwnImages((current) => ({ ...current, [key]: value }));
  }

  function updateCompetitorField(
    columnIndex: number,
    key: keyof Pick<
      CompetitorDraft,
      | "asin"
      | "sales"
      | "price"
      | "variation"
      | "rating"
      | "reviewCount"
      | "title"
      | "productFeatures"
      | "aplus"
    >,
    value: string,
  ) {
    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex ? { ...competitor, [key]: value } : competitor,
      ),
    );
  }

  function getBulletLine(text: string, index: number) {
    return text.split(/\n/)[index] ?? "";
  }

  function updateBulletLine(text: string, index: number, value: string) {
    const lines = text.split(/\n/);
    while (lines.length <= index) {
      lines.push("");
    }
    lines[index] = value;
    return lines.join("\n").replace(/\n+$/u, "");
  }

  function updateCompetitorBullet(columnIndex: number, bulletIndex: number, value: string) {
    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex
          ? {
              ...competitor,
              bullets: updateBulletLine(competitor.bullets, bulletIndex, value),
            }
          : competitor,
      ),
    );
  }

  function renderAsinCell(
    value: string,
    onChange: (value: string) => void,
    styleKey: string,
  ) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-2">
        {renderTextCell(value, onChange, false, false, styleKey)}
        <AmazonLinkButton asin={value} />
      </div>
    );
  }

  function renderTextCell(
    value: string,
    onChange: (value: string) => void,
    multiline = false,
    tall = false,
    styleKey?: string,
  ) {
    const selectCell = () => {
      if (styleKey) setFocusedCellKey(styleKey);
    };
    const rememberSelection = () => {
      if (!styleKey) return;
      const range = selectedRangeInFocusedCell();
      if (range) selectedTextRangeRef.current = { styleKey, range };
    };

    return (
      <div
        role="textbox"
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        data-gallery-cell-key={styleKey}
        className={`${multiline ? (tall ? "h-[150px]" : "h-24") : "h-9"} w-full overflow-auto rounded-md border border-border px-2 py-1.5 text-xs leading-5 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 ${multiline ? "whitespace-pre-wrap" : "whitespace-nowrap"} ${styleClasses(styleKey)}`}
        dangerouslySetInnerHTML={{ __html: richCellHtml(value, styleKey) }}
        onFocus={selectCell}
        onClick={selectCell}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onInput={(event) => onChange(event.currentTarget.innerText.replace(/\n$/u, ""))}
        onKeyDown={(event) => {
          if (!multiline && event.key === "Enter") event.preventDefault();
        }}
      />
    );
  }

  const infoRows: GalleryInfoRow[] = [
    {
      label: "ASIN",
      mineValue: input.asin,
      updateMine: (value: string) => update("asin", value.trim()),
      competitorValue: (competitor: CompetitorDraft) => competitor.asin,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "asin", value.trim()),
      asin: true,
    },
    {
      label: "产品卖点",
      mineValue: input.mainSellingPoint1,
      updateMine: (value: string) => update("mainSellingPoint1", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.productFeatures,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "productFeatures", value),
      multiline: true,
    },
    {
      label: "销量",
      mineValue: ownImages.sales,
      updateMine: (value: string) => updateOwnImagesField("sales", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.sales,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "sales", value),
    },
    {
      label: "价格",
      mineValue: ownImages.price,
      updateMine: (value: string) => updateOwnImagesField("price", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.price,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "price", value),
    },
    {
      label: "变体",
      mineValue: input.variationInfo,
      updateMine: (value: string) => update("variationInfo", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.variation,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "variation", value),
    },
    {
      label: "星级",
      mineValue: ownImages.rating,
      updateMine: (value: string) => updateOwnImagesField("rating", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.rating,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "rating", value),
    },
    {
      label: "评论数",
      mineValue: ownImages.reviewCount,
      updateMine: (value: string) => updateOwnImagesField("reviewCount", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.reviewCount,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "reviewCount", value),
    },
    {
      label: "标题",
      mineValue: input.currentTitle,
      updateMine: (value: string) => update("currentTitle", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.title,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "title", value),
      multiline: true,
    },
    ...Array.from({ length: 6 }).map((_, index) => ({
      label: `5点${index + 1}`,
      mineValue: getBulletLine(input.currentBullets, index),
      updateMine: (value: string) =>
        update("currentBullets", updateBulletLine(input.currentBullets, index, value)),
      competitorValue: (competitor: CompetitorDraft) =>
        getBulletLine(competitor.bullets, index),
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorBullet(columnIndex, index, value),
      multiline: true,
      tall: true,
    })),
  ];

  const aplusRow = {
    label: "A+",
    mineValue: input.aplusRequirements,
    updateMine: (value: string) => update("aplusRequirements", value),
    competitorValue: (competitor: CompetitorDraft) => competitor.aplus,
    updateCompetitor: (columnIndex: number, value: string) =>
      updateCompetitorField(columnIndex, "aplus", value),
    multiline: true,
  };
  const imageRowLabels = Array.from({ length: maxRows }).map(
    (_, index) => `Image ${index + 1}`,
  );
  const excelRows = [...imageRowLabels, ...infoRows.map((row) => row.label), aplusRow.label];

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function imageExtension(image: ImagePreview) {
    const lowerName = image.name.toLowerCase();
    if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "jpeg";
    if (lowerName.endsWith(".gif")) return "gif";
    return "png";
  }

  function excelCellToText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value !== "object") return String(value);

    const richValue = value as {
      richText?: Array<{ text?: string }>;
      text?: string;
      result?: unknown;
      formula?: string;
      hyperlink?: string;
    };
    if (Array.isArray(richValue.richText)) {
      return richValue.richText.map((part) => part.text ?? "").join("");
    }
    if (richValue.text !== undefined) return String(richValue.text);
    if (richValue.result !== undefined) return excelCellToText(richValue.result);
    if (richValue.formula !== undefined) return String(richValue.formula);
    if (richValue.hyperlink !== undefined) return String(richValue.hyperlink);

    return "";
  }

  async function handleExportGalleryExcel() {
    setExcelBusy(true);
    setExcelError("");
    setExcelNotice("");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Competitor Images Gallery");
      const dataColumns = [...competitorColumns, mineColumn];

      worksheet.columns = [
        { key: "label", width: 20 },
        ...dataColumns.map((column) => ({ key: column.key, width: 34 })),
      ];

      worksheet.getCell(1, 1).value = "";
      dataColumns.forEach((column, index) => {
        worksheet.getCell(1, index + 2).value = column.label;
      });

      excelRows.forEach((label, rowIndex) => {
        const rowNumber = rowIndex + 2;
        worksheet.getCell(rowNumber, 1).value = label;
        worksheet.getCell(rowNumber, 1).font = { bold: true };
      });

      infoRows.forEach((row, rowIndex) => {
        const rowNumber = imageRowLabels.length + rowIndex + 2;
        competitorColumns.forEach((column, columnIndex) => {
          const competitor = competitors[column.index];
          const cell = worksheet.getCell(rowNumber, columnIndex + 2);
          const styleKey = galleryCellKey(row.label, column.key);
          setExcelCellText(cell, competitor ? row.competitorValue(competitor) : "", styleKey);
          applyGalleryCellStyleToExcelCell(
            cell,
            styleKey,
          );
        });
        const mineCell = worksheet.getCell(rowNumber, competitorColumns.length + 2);
        const mineStyleKey = galleryCellKey(row.label, mineColumn.key);
        setExcelCellText(mineCell, row.mineValue, mineStyleKey);
        applyGalleryCellStyleToExcelCell(
          mineCell,
          mineStyleKey,
        );
        worksheet.getRow(rowNumber).height = row.tall ? 115 : row.multiline ? 72 : 28;
      });

      const aplusRowNumber = imageRowLabels.length + infoRows.length + 2;
      competitorColumns.forEach((column, columnIndex) => {
        const competitor = competitors[column.index];
        const cell = worksheet.getCell(aplusRowNumber, columnIndex + 2);
        const styleKey = galleryCellKey(aplusRow.label, column.key);
        setExcelCellText(
          cell,
          competitor ? aplusRow.competitorValue(competitor) : "",
          styleKey,
        );
        applyGalleryCellStyleToExcelCell(
          cell,
          styleKey,
        );
      });
      const aplusMineCell = worksheet.getCell(aplusRowNumber, competitorColumns.length + 2);
      const aplusMineStyleKey = galleryCellKey(aplusRow.label, mineColumn.key);
      setExcelCellText(aplusMineCell, aplusRow.mineValue, aplusMineStyleKey);
      applyGalleryCellStyleToExcelCell(
        aplusMineCell,
        aplusMineStyleKey,
      );
      worksheet.getRow(aplusRowNumber).height = 72;

      imageRowLabels.forEach((_, imageIndex) => {
        const rowNumber = imageIndex + 2;
        worksheet.getRow(rowNumber).height = 150;
        worksheet.getCell(rowNumber, 1).value =
          `${imageRowLabels[imageIndex]}\n${ownImages.imageNotes?.[imageIndex] ?? ""}`.trim();

        dataColumns.forEach((column, columnIndex) => {
          const image = column.images[imageIndex];
          if (!image?.url?.startsWith("data:image/")) return;
          const imageId = workbook.addImage({
            base64: image.url,
            extension: imageExtension(image),
          });
          worksheet.addImage(imageId, {
            tl: { col: columnIndex + 1.08, row: rowNumber - 0.92 },
            ext: { width: 170, height: 140 },
          });
          worksheet.getCell(rowNumber, columnIndex + 2).value = image.name;
        });
      });

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };
        });
      });

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).height = 28;
      worksheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `listing-ai-competitor-gallery-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (exportError) {
      setExcelError(exportError instanceof Error ? exportError.message : "Excel 导出失败。");
    } finally {
      setExcelBusy(false);
    }
  }

  async function handleImportGalleryExcel(file: File | null) {
    if (!file) return;
    setExcelBusy(true);
    setExcelError("");
    setExcelNotice("");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error("Excel 中没有可读取的工作表。");

      const headers: string[] = [];
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > 1) headers[colNumber] = excelCellToText(cell.value).trim();
      });
      const normalizedHeaders = headers.map((header) =>
        typeof header === "string" ? header.trim().toLowerCase() : "",
      );
      const competitorColumnNumbers = normalizedHeaders
        .map((header, colNumber) => ({ header, colNumber }))
        .filter(
          ({ header }) =>
            header.startsWith("competitor") || header.startsWith("竞品"),
        )
        .map(({ colNumber }) => colNumber);
      const importedCompetitorCount = competitorColumnNumbers.length;
      const detectedMineColNumber = normalizedHeaders.findIndex(
        (header) => header === "mine",
      );
      const mineColNumber = detectedMineColNumber > 0 ? detectedMineColNumber : 0;
      const nextCompetitors = Array.from(
        { length: Math.max(importedCompetitorCount, competitors.length, 3) },
        (_, index) => ({ ...createEmptyCompetitor(), ...competitors[index] }),
      );
      const nextOwnImages: OwnImageDraft = {
        ...ownImages,
        images: [...ownImages.images],
        imageNotes: [...(ownImages.imageNotes ?? [])],
      };
      const nextInput = { ...input };
      const nextCellStyles = { ...cellStyles };
      const rowByLabel = new Map<string, number>();
      const imageRowIndexByRowNumber = new Map<number, number>();
      worksheet.eachRow((row, rowNumber) => {
        const label = excelCellToText(row.getCell(1).value).split("\n")[0].trim();
        if (!label) return;
        rowByLabel.set(label, rowNumber);
        const imageMatch = /^(?:Image|主图)\s*(\d+)$/iu.exec(label);
        if (imageMatch) {
          imageRowIndexByRowNumber.set(rowNumber, Number(imageMatch[1]) - 1);
        }
      });

      function rowNumberForLabels(labels: string[]) {
        for (const label of labels) {
          const rowNumber = rowByLabel.get(label);
          if (rowNumber) return rowNumber;
        }
        return 0;
      }

      function readCell(labels: string | string[], colNumber: number) {
        const rowNumber = rowNumberForLabels(Array.isArray(labels) ? labels : [labels]);
        return rowNumber ? excelCellToText(worksheet.getCell(rowNumber, colNumber).value) : "";
      }

      function readCellStyle(labels: string | string[], colNumber: number) {
        const rowNumber = rowNumberForLabels(Array.isArray(labels) ? labels : [labels]);
        return rowNumber
          ? excelCellStyleToGalleryStyle(worksheet.getCell(rowNumber, colNumber))
          : {};
      }

      function imageLabels(imageIndex: number) {
        const imageNumber = imageIndex + 1;
        return [`Image ${imageNumber}`, `主图${imageNumber}`, `主图 ${imageNumber}`];
      }

      function imageIndexForExcelRow(rowNumber: number) {
        for (let current = rowNumber; current >= Math.max(1, rowNumber - 1); current -= 1) {
          const imageIndex = imageRowIndexByRowNumber.get(current);
          if (
            imageIndex !== undefined &&
            imageIndex >= 0 &&
            imageIndex < maxRows
          ) {
            return imageIndex;
          }
        }
        return null;
      }

      infoRows.forEach((row) => {
        nextCompetitors.forEach((competitor, index) => {
          const colNumber = competitorColumnNumbers[index] ?? index + 2;
          const value = readCell(row.label, colNumber);
          mergeCellStyle(
            nextCellStyles,
            galleryCellKey(row.label, `competitor-${index}`),
            readCellStyle(row.label, colNumber),
          );
          if (!value) return;
          if (row.label === "ASIN") competitor.asin = value.trim();
          if (row.label === "产品卖点") competitor.productFeatures = value;
          if (row.label === "销量") competitor.sales = value;
          if (row.label === "价格") competitor.price = value;
          if (row.label === "变体") competitor.variation = value;
          if (row.label === "星级") competitor.rating = value;
          if (row.label === "评论数") competitor.reviewCount = value;
          if (row.label === "标题") competitor.title = value;
          if (row.label.startsWith("5点")) {
            const bulletIndex = Number(row.label.replace("5点", "")) - 1;
            competitor.bullets = updateBulletLine(competitor.bullets, bulletIndex, value);
          }
        });
        const mineValue = mineColNumber ? readCell(row.label, mineColNumber) : "";
        if (mineColNumber) {
          mergeCellStyle(
            nextCellStyles,
            galleryCellKey(row.label, mineColumn.key),
            readCellStyle(row.label, mineColNumber),
          );
        }
        if (mineValue) {
          if (row.label === "ASIN") nextInput.asin = mineValue.trim();
          if (row.label === "产品卖点") nextInput.mainSellingPoint1 = mineValue;
          if (row.label === "销量") nextOwnImages.sales = mineValue;
          if (row.label === "价格") nextOwnImages.price = mineValue;
          if (row.label === "变体") nextInput.variationInfo = mineValue;
          if (row.label === "星级") nextOwnImages.rating = mineValue;
          if (row.label === "评论数") nextOwnImages.reviewCount = mineValue;
          if (row.label === "标题") nextInput.currentTitle = mineValue;
          if (row.label.startsWith("5点")) {
            const bulletIndex = Number(row.label.replace("5点", "")) - 1;
            nextInput.currentBullets = updateBulletLine(
              nextInput.currentBullets,
              bulletIndex,
              mineValue,
            );
          }
        }
      });

      const aplusMineValue = mineColNumber ? readCell("A+", mineColNumber) : "";
      if (aplusMineValue) nextInput.aplusRequirements = aplusMineValue;
      nextCompetitors.forEach((competitor, index) => {
        const colNumber = competitorColumnNumbers[index] ?? index + 2;
        const value = readCell("A+", colNumber);
        mergeCellStyle(
          nextCellStyles,
          galleryCellKey(aplusRow.label, `competitor-${index}`),
          readCellStyle("A+", colNumber),
        );
        if (value) competitor.aplus = value;
      });
      if (mineColNumber) {
        mergeCellStyle(
          nextCellStyles,
          galleryCellKey(aplusRow.label, mineColumn.key),
          readCellStyle("A+", mineColNumber),
        );
      }

      for (let imageIndex = 0; imageIndex < maxRows; imageIndex += 1) {
        const rowNumber = rowNumberForLabels(imageLabels(imageIndex));
        if (!rowNumber) continue;
        const labelCell = excelCellToText(worksheet.getCell(rowNumber, 1).value);
        nextOwnImages.imageNotes[imageIndex] = labelCell.split("\n").slice(1).join("\n");
      }

      const mediaItems =
        ((workbook.model as unknown) as {
          media?: Array<{
            index?: number;
            buffer?: Uint8Array | ArrayBuffer;
            extension?: string;
          }>;
        }).media ?? [];
      const mediaById = new Map(
        mediaItems
          .filter((media): media is typeof media & { index: number } =>
            typeof media.index === "number",
          )
          .map((media) => [media.index, media]),
      );
      const worksheetImages = worksheet.getImages();
      for (const image of worksheetImages) {
        const excelRowNumber = image.range.tl.nativeRow + 1;
        const excelColNumber = image.range.tl.nativeCol + 1;
        const imageIndex = imageIndexForExcelRow(excelRowNumber);
        if (imageIndex === null || excelColNumber < 1) continue;
        const media = mediaById.get(Number(image.imageId));
        if (!media?.buffer) continue;
        const extension = media.extension || "png";
        const sourceBytes =
          media.buffer instanceof ArrayBuffer
            ? new Uint8Array(media.buffer)
            : new Uint8Array(
                media.buffer.buffer,
                media.buffer.byteOffset,
                media.buffer.byteLength,
              );
        const buffer = sourceBytes.slice().buffer;
        const blob = new Blob([buffer], {
          type: `image/${extension === "jpg" ? "jpeg" : extension}`,
        });
        const name = `imported-image-${imageIndex + 1}-${excelColNumber}.${extension}`;
        const asset = await saveListingAiImageAsset(
          new File([blob], name, { type: blob.type }),
        );
        const preview = {
          name,
          url: await blobToDataUrl(asset.blob),
          assetId: asset.id,
        };
        const competitorIndex = competitorColumnNumbers.indexOf(excelColNumber);
        if (mineColNumber && excelColNumber === mineColNumber) {
          nextOwnImages.images[imageIndex] = preview;
        } else if (competitorIndex >= 0) {
          nextCompetitors[competitorIndex].images[imageIndex] = preview;
        }
      }

      setCompetitors(nextCompetitors);
      setOwnImages(nextOwnImages);
      setCellStyles(nextCellStyles);
      (Object.keys(nextInput) as Array<keyof ListingOptimizationRequest>).forEach((key) =>
        update(key, nextInput[key]),
      );
      if (!worksheetImages.length) {
        setExcelNotice("已导入文字信息；这个 Excel 文件里没有可读取的嵌入图片。");
      }
    } catch (importError) {
      setExcelError(importError instanceof Error ? importError.message : "Excel 导入失败。");
    } finally {
      setExcelBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Competitor Images Gallery</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) =>
                void handleImportGalleryExcel(event.target.files?.[0] ?? null)
              }
            />
            {excelError ? (
              <span className="max-w-md truncate text-xs font-semibold text-red-600">
                {excelError}
              </span>
            ) : null}
            {excelNotice ? (
              <span className="max-w-md truncate text-xs font-semibold text-muted">
                {excelNotice}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!focusedCellKey}
              onClick={markSelectedTextRed}
              title="当前单元格文字标红"
            >
              <span className="text-base font-black leading-none text-red-700">A</span>
              红字
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!focusedCellKey}
              onClick={() => toggleFocusedCellStyle("yellowBg")}
              title="当前单元格背景标黄"
            >
              <Highlighter className="h-4 w-4 text-yellow-600" />
              黄底
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={addCompetitorColumn}
              title="Add competitor"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              disabled={competitors.length <= 1}
              onClick={removeCompetitorColumn}
              title="Remove competitor"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={excelBusy}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              导入 Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={excelBusy}
              onClick={() => void handleExportGalleryExcel()}
            >
              {excelBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              导出 Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[1030px] overflow-auto thin-scrollbar">
          <table
            className="min-w-full table-fixed text-left text-sm"
            style={{ width: tableWidth }}
          >
            <thead className="sticky top-0 z-10 bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="sticky left-0 z-20 w-36 bg-surface-muted px-4 py-3">
                  Image
                </th>
                {competitorColumns.map((column) => (
                  <th key={column.key} className="w-[260px] px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span>{column.label}</span>
                      <MiniUploader
                        images={column.images}
                        label="Upload"
                        onUpload={(files) =>
                          handleImageUpload(files, (images) =>
                            setColumnImages(column.type, column.index, images),
                          )
                        }
                      />
                    </div>
                  </th>
                ))}
                <th className="w-[260px] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{mineColumn.label}</span>
                    <MiniUploader
                      images={mineColumn.images}
                      label="Upload"
                      onUpload={(files) =>
                        handleImageUpload(files, (images) =>
                          setColumnImages(mineColumn.type, mineColumn.index, images),
                        )
                      }
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: maxRows }).map((_, index) => (
                <tr key={index}>
                  <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle">
                    <label className="block text-sm font-black text-foreground">
                      Image {index + 1}
                    </label>
                    <textarea
                      className="mt-2 h-[200px] w-full resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs font-medium leading-5 text-foreground outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/10"
                      value={ownImages.imageNotes?.[index] ?? ""}
                      onChange={(event) =>
                        updateImageNote(index, event.target.value)
                      }
                      placeholder="备注"
                    />
                  </td>
                  {competitorColumns.map((column) => (
                    <td key={column.key} className="px-4 py-3 align-top">
                      <GalleryCell
                        image={column.images[index]}
                        draggable={Boolean(column.images[index])}
                        onDragStart={() =>
                          setDraggedImage({
                            column: column.type,
                            columnIndex: column.index,
                            imageIndex: index,
                          })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() =>
                          handleDrop(column.type, column.index, index)
                        }
                        onMoveUp={() =>
                          moveImage(column.type, column.index, index, index - 1)
                        }
                        onMoveDown={() =>
                          moveImage(column.type, column.index, index, index + 1)
                        }
                        canMoveUp={index > 0}
                        canMoveDown={index < column.images.length - 1}
                        onPreview={() => setPreviewImage(column.images[index])}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3 align-top">
                    <GalleryCell
                      image={mineColumn.images[index]}
                      mine
                      draggable={Boolean(mineColumn.images[index])}
                      onDragStart={() =>
                        setDraggedImage({
                          column: mineColumn.type,
                          columnIndex: mineColumn.index,
                          imageIndex: index,
                        })
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() =>
                        handleDrop(mineColumn.type, mineColumn.index, index)
                      }
                      onMoveUp={() =>
                        moveImage(mineColumn.type, mineColumn.index, index, index - 1)
                      }
                      onMoveDown={() =>
                        moveImage(mineColumn.type, mineColumn.index, index, index + 1)
                      }
                      canMoveUp={index > 0}
                      canMoveDown={index < mineColumn.images.length - 1}
                      onPreview={() => setPreviewImage(mineColumn.images[index])}
                    />
                  </td>
                </tr>
              ))}
              {infoRows.map((row) => (
                <tr key={row.label}>
                  <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle text-sm font-black text-foreground">
                    {row.label}
                  </td>
                  {competitorColumns.map((column) => {
                    const competitor = competitors[column.index];
                    const value = competitor ? row.competitorValue(competitor) : "";
                    const styleKey = galleryCellKey(row.label, column.key);
                    return (
                      <td key={column.key} className="px-4 py-3 align-top">
                        {row.asin
                          ? renderAsinCell(value, (nextValue) =>
                              row.updateCompetitor(column.index, nextValue),
                              styleKey,
                            )
                          : renderTextCell(
                              value,
                              (nextValue) =>
                                row.updateCompetitor(column.index, nextValue),
                              row.multiline,
                              row.tall,
                              styleKey,
                            )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 align-top">
                    {row.asin
                      ? renderAsinCell(
                          row.mineValue,
                          row.updateMine,
                          galleryCellKey(row.label, mineColumn.key),
                        )
                      : renderTextCell(
                          row.mineValue,
                          row.updateMine,
                          row.multiline,
                          row.tall,
                          galleryCellKey(row.label, mineColumn.key),
                        )}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle text-sm font-black text-foreground">
                  {aplusRow.label}
                </td>
                {competitorColumns.map((column) => {
                  const competitor = competitors[column.index];
                  const styleKey = galleryCellKey(aplusRow.label, column.key);
                  return (
                    <td key={column.key} className="px-4 py-3 align-top">
                      {renderTextCell(
                        competitor ? aplusRow.competitorValue(competitor) : "",
                        (value) => aplusRow.updateCompetitor(column.index, value),
                        aplusRow.multiline,
                        false,
                        styleKey,
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 align-top">
                  {renderTextCell(
                    aplusRow.mineValue,
                    aplusRow.updateMine,
                    aplusRow.multiline,
                    false,
                    galleryCellKey(aplusRow.label, mineColumn.key),
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Image Assets Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className={`${fieldClass} min-h-32 resize-y`}
            value={ownImages.structureNotes}
            onChange={(event) =>
              setOwnImages((current) => ({
                ...current,
                structureNotes: event.target.value,
              }))
            }
            placeholder="记录自身图片结构、差距、希望 AI 策划强化的方向"
          />
        </CardContent>
      </Card>
      {previewImage ? (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </div>
  );
}

function VisualAplusSection({
  competitors,
  ownImages,
  setCompetitors,
  setOwnImages,
  input,
  update,
  error,
  canSubmit,
  loading,
  onGenerate,
  result,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  error: string;
  canSubmit: boolean;
  loading: boolean;
  onGenerate: () => void;
  result: ListingOptimizationResult | null;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <ImagesSection
        competitors={competitors}
        ownImages={ownImages}
        setCompetitors={setCompetitors}
        setOwnImages={setOwnImages}
        input={input}
        update={update}
        handleImageUpload={handleImageUpload}
      />
      <AplusSection
        result={result}
        input={input}
        update={update}
        error={error}
        canSubmit={canSubmit}
        loading={loading}
        onGenerate={onGenerate}
      />
    </div>
  );
}

function CompetitorColumn({
  label,
  asin,
  mainImage,
  title,
  bullets,
  targetAudience,
  useScenarios,
  productFeatures,
  opportunity,
  screenshot,
  images,
  onAsinChange,
  onMainImageUpload,
  onTitleChange,
  onBulletsChange,
  onTargetAudienceChange,
  onUseScenariosChange,
  onProductFeaturesChange,
  onOpportunityChange,
  onScreenshotUpload,
  onImagesUpload,
}: {
  label: string;
  asin: string;
  mainImage: ImagePreview[];
  title: string;
  bullets: string;
  targetAudience: string;
  useScenarios: string;
  productFeatures: string;
  opportunity: string;
  screenshot: ImagePreview[];
  images: ImagePreview[];
  onAsinChange: (value: string) => void;
  onMainImageUpload: (files: FileList | null) => void;
  onTitleChange: (value: string) => void;
  onBulletsChange: (value: string) => void;
  onTargetAudienceChange: (value: string) => void;
  onUseScenariosChange: (value: string) => void;
  onProductFeaturesChange: (value: string) => void;
  onOpportunityChange: (value: string) => void;
  onScreenshotUpload: (files: FileList | null) => void;
  onImagesUpload: (files: FileList | null) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border bg-surface-muted px-4 py-3">
        <p className="text-base font-black text-foreground">{label}</p>
      </div>
      <div className="grid grid-rows-[160px_160px_300px_128px_128px_160px_160px_192px_160px_272px] gap-4 p-4">
        <ImageStrip
          title="主图"
          images={mainImage}
          onUpload={onMainImageUpload}
          variant="main"
        />
        <InfoField label="标题" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="五点描述" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-52 resize-none`}
            value={bullets}
            onChange={(event) => onBulletsChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="ASIN" className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
            <input
              className={fieldClass}
              value={asin}
              onChange={(event) => onAsinChange(event.target.value.trim())}
            />
            <AmazonLinkButton asin={asin} />
          </div>
        </InfoField>
        <InfoField label="目标人群" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={targetAudience}
            onChange={(event) => onTargetAudienceChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="使用场景" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={useScenarios}
            onChange={(event) => onUseScenariosChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="产品特点" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={productFeatures}
            onChange={(event) => onProductFeaturesChange(event.target.value)}
          />
        </InfoField>
        <InfoField label="卖点对比" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={opportunity}
            onChange={(event) => onOpportunityChange(event.target.value)}
          />
        </InfoField>
        <ImageStrip
          title="截图"
          images={screenshot}
          onUpload={onScreenshotUpload}
          variant="single"
        />
        <ImageStrip
          title="图片"
          images={images}
          onUpload={onImagesUpload}
          variant="gallery"
        />
      </div>
    </div>
  );
}

function MineColumn({
  input,
  ownImages,
  update,
  setOwnImages,
  onImagesUpload,
}: {
  input: ListingOptimizationRequest;
  ownImages: OwnImageDraft;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  onImagesUpload: (files: FileList | null) => void;
}) {
  const bulletLines = input.currentBullets
    .split(/\n+/)
    .filter((line) => line.trim());
  const bulletTotal = input.currentBullets.length;

  return (
    <div className="rounded-md border border-brand bg-brand/5">
      <div className="border-b border-brand/20 bg-brand px-4 py-3">
        <p className="text-base font-black text-white">Mine</p>
      </div>
      <div className="grid grid-rows-[160px_160px_300px_128px_128px_160px_160px_192px_160px_272px] gap-4 p-4">
        <InfoField label="图片 / 机会备注" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={ownImages.structureNotes}
            onChange={(event) =>
              setOwnImages((current) => ({
                ...current,
                structureNotes: event.target.value,
              }))
            }
            placeholder="我们要放大的差异点、图片结构、需要补拍的问题"
          />
        </InfoField>

        <InfoField label="标题" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-20 resize-none ${input.currentTitle.length > 200 ? "border-red-300 bg-red-50" : ""}`}
            value={input.currentTitle}
            onChange={(event) => update("currentTitle", event.target.value)}
            placeholder="标题通用上限 ≤200 字符；最强差异化卖点放在前 80 位"
          />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold">
            <span
              className={
                input.currentTitle.length <= 200
                  ? "text-green-700"
                  : "text-red-700"
              }
            >
              {input.currentTitle.length}/200 chars
            </span>
            <span
              className={
                input.currentTitle.slice(0, 80).trim()
                  ? "text-green-700"
                  : "text-amber-700"
              }
            >
              前 80 字符放核心卖点
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            移动端仅展示前 70-80 字符，最强差异化卖点必须前置。
          </p>
        </InfoField>

        <InfoField label="五点描述" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-52 resize-none ${bulletTotal > 1000 ? "border-red-300 bg-red-50" : ""}`}
            value={input.currentBullets}
            onChange={(event) => update("currentBullets", event.target.value)}
            placeholder={
              "每行一条，共 5 条；单条 10-255 字符，推荐 120-200 字符"
            }
          />
          <p
            className={`mt-2 text-xs font-bold ${bulletTotal <= 1000 ? "text-green-700" : "text-red-700"}`}
          >
            已填写 {bulletLines.length}/5 条；合计 {bulletTotal}/1000
            字符，利于索引收录。
          </p>
        </InfoField>

        <InfoField label="ASIN" className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
            <input
              className={fieldClass}
              value={input.asin}
              onChange={(event) => update("asin", event.target.value.trim())}
            />
            <AmazonLinkButton asin={input.asin} />
          </div>
        </InfoField>
        <InfoField label="目标人群" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={input.targetAudience}
            onChange={(event) => update("targetAudience", event.target.value)}
          />
        </InfoField>
        <InfoField label="使用场景" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-16 resize-none`}
            value={input.useScenarios}
            onChange={(event) => update("useScenarios", event.target.value)}
          />
        </InfoField>
        <InfoField label="产品特点" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-24 resize-none`}
            value={input.productFacts}
            onChange={(event) => update("productFacts", event.target.value)}
          />
        </InfoField>
        <InfoField label="主卖点" className="overflow-hidden">
          <textarea
            className={`${fieldClass} h-28 resize-none border-amber-300 bg-amber-50/40`}
            value={input.mainSellingPoint1}
            onChange={(event) =>
              update("mainSellingPoint1", event.target.value)
            }
            placeholder="主卖点"
          />
        </InfoField>
        <AlignedPlaceholder label="截图" />
        <ImageStrip
          title="图片"
          images={ownImages.images}
          onUpload={onImagesUpload}
          mine
          variant="gallery"
        />
      </div>
    </div>
  );
}

function ImageStrip({
  title,
  images,
  onUpload,
  mine,
  variant = "gallery",
}: {
  title: string;
  images: ImagePreview[];
  onUpload: (files: FileList | null) => void;
  mine?: boolean;
  variant?: "main" | "single" | "gallery";
}) {
  const previewHeight = variant === "gallery" ? "h-40" : "h-28";
  const gridClass = variant === "gallery" ? "grid-cols-3" : "grid-cols-1";

  return (
    <div className="rounded-md border border-border bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className={labelClass}>{title}</p>
        <MiniUploader images={images} label="Upload" onUpload={onUpload} />
      </div>
      <div className={`${previewHeight} overflow-hidden`}>
        {images.length ? (
          <div className={`grid ${gridClass} gap-2`}>
            {images.slice(0, variant === "gallery" ? 9 : 1).map((image) => (
              <GalleryCell
                key={image.url}
                image={image}
                mine={mine}
                compact={variant !== "gallery"}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
            No Images
          </div>
        )}
      </div>
    </div>
  );
}

function AmazonLinkButton({ asin }: { asin: string }) {
  const cleanAsin = asin.trim();
  const disabled = !cleanAsin;

  return (
    <a
      aria-disabled={disabled}
      className={`flex h-10 items-center justify-center rounded-md border border-border bg-white text-muted transition ${
        disabled
          ? "pointer-events-none opacity-40"
          : "hover:bg-surface-muted hover:text-brand"
      }`}
      href={
        disabled
          ? undefined
          : `https://www.amazon.com/dp/${encodeURIComponent(cleanAsin)}`
      }
      rel="noreferrer"
      target="_blank"
      title="Open Amazon listing"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
}

function GalleryCell({
  image,
  mine,
  compact,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onPreview,
}: {
  image?: ImagePreview;
  mine?: boolean;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onPreview?: () => void;
}) {
  return image ? (
    <div
      className={`group overflow-hidden rounded-md border ${mine ? "border-brand" : "border-border"} bg-white`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="relative">
        <button
          className={`${compact ? "h-20" : "aspect-square"} flex w-full cursor-zoom-in items-center justify-center bg-white`}
          onClick={onPreview}
          type="button"
          title="View large image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.name}
            className="h-full w-full object-contain"
          />
        </button>
        {draggable ? (
          <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/95 text-muted shadow-sm hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              type="button"
              title="Move up"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/95 text-muted shadow-sm hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              type="button"
              title="Move down"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted">
        {draggable ? <GripVertical className="h-3.5 w-3.5 shrink-0" /> : null}
        <p className="truncate">{image.name}</p>
      </div>
    </div>
  ) : (
    <div
      className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      Empty
    </div>
  );
}

function ImagePreviewModal({
  image,
  onClose,
}: {
  image: ImagePreview;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="truncate text-sm font-bold text-foreground">
            {image.name}
          </p>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-muted p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.name}
            className="max-h-[78vh] max-w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}

function AnalysisSection({
  result,
  loading,
  error,
  canSubmit,
  onGenerate,
}: {
  result: ListingOptimizationResult | null;
  loading: boolean;
  error: string;
  canSubmit: boolean;
  onGenerate: () => void;
}) {
  if (!result) {
    return (
      <EmptyAiState
        title="AI Analysis"
        loading={loading}
        error={error}
        canSubmit={canSubmit}
        onGenerate={onGenerate}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <AnalysisCard
        title="Position"
        content={result.aiAnalysis.position || result.positioning.oneSentence}
        tone="blue"
      />
      <AnalysisList
        title="Strength"
        items={result.aiAnalysis.strength}
        tone="green"
      />
      <AnalysisList
        title="Weakness"
        items={result.aiAnalysis.weakness}
        tone="amber"
      />
      <AnalysisList
        title="Opportunity"
        items={result.aiAnalysis.opportunity}
        tone="blue"
      />
      <AnalysisList title="Risk" items={result.aiAnalysis.risk} tone="red" />
    </div>
  );
}

function ListingSection({
  result,
  copied,
  copyText,
}: {
  result: ListingOptimizationResult | null;
  copied: string;
  copyText: (key: string, value: string) => void;
}) {
  if (!result) return <EmptyOutput title="Final Listing" />;

  return (
    <div className="space-y-4">
      <OutputHeader
        title="Final Listing"
        onCopy={() => copyText("listing", formatCopywriting(result))}
        copied={copied === "listing"}
      />
      <Card>
        <CardHeader>
          <CardTitle>Title Generation</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {result.titleOptions.map((option) => (
            <div
              key={option.type}
              className="rounded-md border border-border p-4"
            >
              <Badge tone={option.type === "balanced" ? "green" : "blue"}>
                {option.type}
              </Badge>
              <p className="mt-3 text-sm font-bold leading-6 text-foreground">
                {option.title}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                {option.selfCheck}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bullet Generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.bullets.map((bullet, index) => (
            <div
              key={`${bullet.bullet}-${index}`}
              className="rounded-md border border-border p-4"
            >
              <p className="font-bold leading-6 text-foreground">
                {index + 1}. {bullet.bullet}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted">
                {bullet.chineseExplanation}
              </p>
              <p className="mt-1 text-xs font-semibold text-brand">
                Image: {bullet.imageExpression}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ImagePlanSection({
  result,
  copied,
  copyText,
  imageGenerator,
  imageGenerating,
  imageGeneratorError,
  setImageGenerator,
  handleImageUpload,
  onRunImageGenerator,
}: {
  result: ListingOptimizationResult | null;
  copied: string;
  copyText: (key: string, value: string) => void;
  imageGenerator: ImageGeneratorDraft;
  imageGenerating: boolean;
  imageGeneratorError: string;
  setImageGenerator: React.Dispatch<React.SetStateAction<ImageGeneratorDraft>>;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
  onRunImageGenerator: () => void;
}) {
  return (
    <div className="space-y-4">
      {result ? (
        <>
          <OutputHeader
            title="Image Execution Board"
            onCopy={() => copyText("images", formatImages(result))}
            copied={copied === "images"}
          />
          <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="px-4 py-3">No</th>
                <th className="px-4 py-3">主题</th>
                <th className="px-4 py-3">卖点</th>
                <th className="px-4 py-3">文案</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">Prompt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.imagePlan.map((item) => (
                <tr key={`${item.imageNo}-${item.slot}`} className="align-top">
                  <td className="px-4 py-3 font-black text-foreground">
                    {item.imageNo}
                  </td>
                  <td className="px-4 py-3 font-bold text-foreground">
                    {item.theme}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {item.amplifiedSellingPoint}
                  </td>
                  <td className="px-4 py-3 text-muted">{item.englishCopy}</td>
                  <td className="px-4 py-3">
                    <Badge tone="amber">Planned</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer font-bold text-brand">
                        展开
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-muted">
                        {item.enPrompt}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-muted">
                        {item.negativePrompt}
                      </p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
          </Card>
        </>
      ) : (
        <EmptyOutput title="Image Execution Board" />
      )}
      <ImagesGeneratorBoard
        draft={imageGenerator}
        error={imageGeneratorError}
        loading={imageGenerating}
        setDraft={setImageGenerator}
        handleImageUpload={handleImageUpload}
        onRun={onRunImageGenerator}
      />
    </div>
  );
}

function ImagesGeneratorBoard({
  draft,
  error,
  loading,
  setDraft,
  handleImageUpload,
  onRun,
}: {
  draft: ImageGeneratorDraft;
  error: string;
  loading: boolean;
  setDraft: React.Dispatch<React.SetStateAction<ImageGeneratorDraft>>;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
  onRun: () => void;
}) {
  const ownViewCount = imageGeneratorViews.reduce(
    (total, view) => total + draft.ownViews[view.key].length,
    0,
  );
  const canRun =
    ownViewCount > 0 &&
    draft.competitorImages.length > 0 &&
    draft.prompt.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Images Generator</CardTitle>
            <p className="mt-1 text-xs font-semibold text-muted">
              上传竞品图和我的六视图，编辑提示词后生成图片；API 接入点已预留。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={canRun ? "green" : "gray"}>
              {ownViewCount}/6 Views · {draft.competitorImages.length} Competitors
            </Badge>
            {draft.lastRunAt ? <Badge tone="blue">{draft.lastRunAt}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <div className="min-w-[1160px] divide-y divide-border">
          <div className="grid grid-cols-[120px_repeat(6,minmax(150px,1fr))] divide-x divide-border">
            <div className="p-3 text-sm font-bold text-foreground">我的六视图</div>
            {imageGeneratorViews.map((view) => (
              <div key={view.key} className="p-3">
                <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2">
                  <p className="min-w-0 text-sm font-bold text-foreground">{view.label}</p>
                  <MiniUploader
                    images={draft.ownViews[view.key]}
                    label="上传"
                    onUpload={(files) =>
                      handleImageUpload(files, (images) =>
                        setDraft((current) => ({
                          ...current,
                          ownViews: {
                            ...current.ownViews,
                            [view.key]: images.slice(0, 1),
                          },
                        })),
                      )
                    }
                  />
                </div>
                <ImagePreviewGrid images={draft.ownViews[view.key]} compact />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[120px_minmax(320px,1.05fr)_minmax(260px,0.9fr)_minmax(340px,1.15fr)] divide-x divide-border">
            <div className="p-3 text-sm font-bold text-foreground">上传竞品图</div>
            <div className="p-3">
              <MiniUploader
                images={draft.competitorImages}
                label="上传竞品图"
                onUpload={(files) =>
                  handleImageUpload(files, (images) =>
                    setDraft((current) => ({
                      ...current,
                      competitorImages: images,
                    })),
                  )
                }
              />
              <ImagePreviewGrid images={draft.competitorImages} />
            </div>
            <div className="flex flex-col gap-3 p-3">
              <details className="rounded-md border border-border bg-surface-muted/50 p-3">
                <summary className="cursor-pointer text-sm font-bold text-brand">
                  提示词
                </summary>
                <textarea
                  className={`${fieldClass} mt-3 min-h-44 resize-y`}
                  value={draft.prompt}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                />
              </details>
              <Button className="self-start" disabled={!canRun || loading} onClick={onRun}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                运行按钮
              </Button>
              {error ? (
                <p className="max-w-64 text-center text-xs font-semibold leading-5 text-red-600">
                  {error}
                </p>
              ) : (
                <p className="max-w-64 text-center text-xs font-semibold leading-5 text-muted">
                  调用 Settings 中保存的模型配置。
                </p>
              )}
            </div>
            <div className="p-3">
              <p className="mb-2 text-sm font-bold text-foreground">
                生成图展示
              </p>
              <ImagePreviewGrid images={draft.generatedImages} />
              {false && !draft.generatedImages.length ? (
                <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
                  等待生成图片
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ImagePreviewGrid({
  images,
  compact = false,
}: {
  images: ImagePreview[];
  compact?: boolean;
}) {
  if (!images.length) {
    return (
      <div
        className={`flex aspect-square items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted ${
          compact ? "w-full" : "mt-3 w-full max-w-72"
        }`}
      >
        暂无图片
      </div>
    );
  }

  return (
    <div
      className={`grid gap-2 ${
        compact
          ? "grid-cols-1"
          : "mt-3 grid-cols-[repeat(auto-fill,minmax(150px,220px))]"
      }`}
    >
      {images.map((image) => (
        <figure
          key={`${image.name}-${image.url.slice(0, 24)}`}
          className="overflow-hidden rounded-md border border-border bg-white"
        >
          <img
            className="aspect-square w-full object-contain"
            src={image.url}
            alt={image.name}
          />
          <figcaption className="truncate border-t border-border px-2 py-1 text-[11px] font-semibold text-muted">
            {image.name}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function AplusSection({
  result,
  input,
  update,
  error,
  canSubmit,
  loading,
  onGenerate,
}: {
  result: ListingOptimizationResult | null;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  error: string;
  canSubmit: boolean;
  loading: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>A+ Requirements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className={`${fieldClass} min-h-32 resize-y`}
            value={input.aplusRequirements}
            onChange={(event) =>
              update("aplusRequirements", event.target.value)
            }
          />
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </div>
          ) : null}
          <Button disabled={!canSubmit} onClick={onGenerate}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Generate / Regenerate
          </Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>A+ Execution Board</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {result.aplusPlan.map((module) => (
              <div
                key={module.moduleNo}
                className="rounded-md border border-border p-4"
              >
                <Badge tone="blue">{module.moduleNo}</Badge>
                <p className="mt-3 font-bold text-foreground">
                  {module.coreMessage}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  布局：{module.layout}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  文案：{module.copy}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  视觉：{module.visualElements}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ReviewSection({
  result,
}: {
  result: ListingOptimizationResult | null;
}) {
  if (!result) return <EmptyOutput title="AI Review" />;

  const review = result.aiReview;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI Review</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ScoreTile label="Listing" value={review.listingScore} />
          <ScoreTile label="Image" value={review.imageScore} />
          <ScoreTile label="A+" value={review.aplusScore} />
          <ScoreTile label="Keyword" value={review.keywordScore} />
          <ScoreTile label="Buyer Desire" value={review.buyerDesireScore} />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AnalysisCard title="Verdict" content={review.verdict} tone="blue" />
        <AnalysisList title="Must Fix" items={review.mustFix} tone="red" />
        <AnalysisList
          title="Regeneration Advice"
          items={review.regenerationAdvice}
          tone="amber"
        />
      </div>
    </div>
  );
}

function ReviewHistorySection({
  result,
  records,
  onLoad,
}: {
  result: ListingOptimizationResult | null;
  records: SavedRecord[];
  onLoad: (record: SavedRecord) => void;
}) {
  return (
    <div className="space-y-4">
      <ReviewSection result={result} />
      <HistorySection records={records} onLoad={onLoad} />
    </div>
  );
}

function HistorySection({
  records,
  onLoad,
}: {
  records: SavedRecord[];
  onLoad: (record: SavedRecord) => void;
}) {
  const grouped = records.reduce<Record<string, SavedRecord[]>>(
    (acc, record) => {
      acc[record.productName] = acc[record.productName]
        ? [...acc[record.productName], record]
        : [record];
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-4">
      {Object.entries(grouped).length ? (
        Object.entries(grouped).map(([product, productRecords]) => (
          <Card key={product}>
            <CardHeader>
              <CardTitle>{product}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {productRecords.map((record) => (
                <button
                  key={record.id}
                  className="flex w-full items-center justify-between rounded-md border border-border px-4 py-3 text-left hover:bg-surface-muted"
                  onClick={() => onLoad(record)}
                >
                  <span>
                    <span className="block font-bold text-foreground">
                      Version {record.version}
                    </span>
                    <span className="text-xs text-muted">
                      {record.createdAt} · {record.submitter}
                    </span>
                  </span>
                  <Badge tone="gray">Load</Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        ))
      ) : (
        <EmptyOutput title="History" />
      )}
    </div>
  );
}

function InfoField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-border bg-white p-4 ${className}`}
    >
      <p className={labelClass}>{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function AlignedPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-muted/60 p-4">
      <p className={labelClass}>{label}</p>
      <div className="mt-3 flex h-[calc(100%-28px)] items-center justify-center rounded-md bg-white/60 text-xs font-bold text-muted">
        不适用
      </div>
    </div>
  );
}

function MiniUploader({
  images,
  onUpload,
  label = "Upload",
}: {
  images: ImagePreview[];
  onUpload: (files: FileList | null) => void;
  label?: string;
}) {
  return (
    <label className="inline-flex min-w-28 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs font-bold text-muted hover:bg-surface-muted">
      <Upload className="h-4 w-4" />
      {images.length ? `${images.length} Images` : label}
      <input
        className="hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => onUpload(event.target.files)}
      />
    </label>
  );
}

function EmptyAiState({
  title,
  loading,
  error,
  canSubmit,
  onGenerate,
}: {
  title: string;
  loading: boolean;
  error: string;
  canSubmit: boolean;
  onGenerate: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-[420px] flex-col items-center justify-center text-center">
        <Sparkles className="h-10 w-10 text-brand" />
        <h2 className="mt-4 text-xl font-black text-foreground">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted">
          录入 Information、Competitors、Images 后，生成 AI
          分析、Listing、图片执行表、A+ 和自检结果。
        </p>
        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}
        <Button className="mt-5" disabled={!canSubmit} onClick={onGenerate}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate AI Analysis
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyOutput({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <Layers3 className="h-10 w-10 text-muted" />
        <h2 className="mt-4 text-xl font-black text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted">请先生成 AI Analysis。</p>
      </CardContent>
    </Card>
  );
}

function WorkspaceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-32 flex-col justify-center p-4">
      <p className="text-xs font-bold uppercase tracking-normal text-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-foreground">{value}</p>
    </div>
  );
}

function OutputHeader({
  title,
  onCopy,
  copied,
}: {
  title: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-white px-5 py-4 shadow-sm">
      <h2 className="text-lg font-black text-foreground">{title}</h2>
      <Button variant="secondary" size="sm" onClick={onCopy}>
        {copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Clipboard className="h-4 w-4" />
        )}
        {copied ? "已复制" : "复制"}
      </Button>
    </div>
  );
}

function AnalysisCard({
  title,
  content,
  tone,
}: {
  title: string;
  content: string;
  tone: "blue" | "green" | "amber" | "red";
}) {
  return (
    <Card>
      <CardHeader>
        <Badge tone={tone}>{title}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-semibold leading-6 text-foreground">
          {content || "暂无"}
        </p>
      </CardContent>
    </Card>
  );
}

function AnalysisList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "blue" | "green" | "amber" | "red";
}) {
  return (
    <Card>
      <CardHeader>
        <Badge tone={tone}>{title}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {items?.length ? (
          items.map((item, index) => (
            <p
              key={`${item}-${index}`}
              className="text-sm leading-6 text-foreground"
            >
              {index + 1}. {item}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted">暂无</p>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-2 text-3xl font-black text-foreground">
        {value || "--"}
      </p>
    </div>
  );
}

function buildCompetitorInfo(competitors: CompetitorDraft[], ownNotes: string) {
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

function buildImageRequirements(
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

function formatCopywriting(result: ListingOptimizationResult) {
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

function formatImages(result: ListingOptimizationResult) {
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

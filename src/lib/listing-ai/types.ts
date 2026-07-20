export type ListingTone = "professional" | "friendly" | "premium" | "direct";

export type Marketplace = "US" | "UK" | "DE" | "FR" | "IT" | "ES" | "JP" | "CA" | "AU";

export interface ListingOptimizationRequest {
  marketplace: Marketplace;
  language: "zh-CN" | "en-US";
  tone: ListingTone;
  submitter: string;
  productChineseName: string;
  productEnglishName: string;
  asin: string;
  brand: string;
  productType: string;
  targetAudience: string;
  useScenarios: string;
  variationInfo: string;
  currentTitle: string;
  currentBullets: string;
  currentDescription: string;
  titleKeywords: string;
  bulletKeywords: string;
  adData: string;
  productFacts: string;
  mainSellingPoint1: string;
  mainSellingPoint2: string;
  mainSellingPoint3: string;
  otherSellingPoints: string;
  material: string;
  dimensions: string;
  packageList: string;
  accessories: string;
  specialStructure: string;
  detailsToAmplify: string;
  competitorInfo: string;
  imageRequirements: string;
  aplusRequirements: string;
}

export interface ListingOptimizationApiRequest extends ListingOptimizationRequest {
  aiSettings?: {
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    model: string;
    wireApi: "chat_completions" | "responses" | "image_generations";
    timeoutSeconds: number;
  };
}

export interface KeywordCoverageItem {
  keyword: string;
  priority: "primary" | "secondary" | "long-tail" | "ad-data";
  placement: "title" | "bullets" | "description" | "backend" | "missing";
  note: string;
}

export interface PositioningResult {
  oneSentence: string;
  strongestSellingPoint: string;
  buyerReason: string;
  competitorOpportunity: string;
}

export interface AiAnalysisResult {
  position: string;
  strength: string[];
  weakness: string[];
  opportunity: string[];
  risk: string[];
}

export interface TitleOption {
  type: "seo" | "conversion" | "balanced";
  title: string;
  primaryKeywords: string;
  secondaryKeywords: string;
  sellingPointWords: string;
  selfCheck: string;
}

export interface BulletRecommendation {
  bullet: string;
  chineseExplanation: string;
  sellingPoint: string;
  imageExpression: string;
  needsFactCheck: string;
}

export interface ImageRecommendation {
  imageNo: string;
  slot: string;
  theme: string;
  buyerTakeaway: string;
  layout: string;
  productAngle: string;
  amplifiedSellingPoint: string;
  englishCopy: string;
  designerInstruction: string;
  competitorReference: string;
  avoid: string;
  selfCheck: string;
  cnPrompt: string;
  enPrompt: string;
  negativePrompt: string;
  finishingRequirements: string;
}

export interface AplusModuleRecommendation {
  moduleNo: string;
  coreMessage: string;
  layout: string;
  copy: string;
  visualElements: string;
}

export interface DesignerChecklistItem {
  imageNo: string;
  checklist: string[];
}

export interface AiReviewResult {
  listingScore: number;
  imageScore: number;
  aplusScore: number;
  keywordScore: number;
  buyerDesireScore: number;
  verdict: string;
  mustFix: string[];
  regenerationAdvice: string[];
}

export interface ListingOptimizationResult {
  score: number;
  positioning: PositioningResult;
  aiAnalysis: AiAnalysisResult;
  titleOptions: TitleOption[];
  title: string;
  bullets: BulletRecommendation[];
  description: string;
  backendSearchTerms: string;
  keywordCoverage: KeywordCoverageItem[];
  imagePlan: ImageRecommendation[];
  aplusPlan: AplusModuleRecommendation[];
  designerChecklist: DesignerChecklistItem[];
  aiReview: AiReviewResult;
  complianceNotes: string[];
  nextActions: string[];
}

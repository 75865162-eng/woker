import type { Product, ProductImageAsset } from "@/lib/products/types";
export type Brief = { keyword: string; chineseName?: string; englishName?: string; priceMin?: number; priceMax?: number; solutionKeywords?: string[] };
export type Competitor = { imageUploadWorkspaceId?: string; sales30Days?: { value: number | null; heuristic: true; method: "uncalibrated_bsr_power_law" }; asin: string; title: string; url: string; price: number | null; rating: number | null; reviewsCount: number | null; bsr?: number | null; bullets?: string[]; mainImageUrl?: string; variations?: string[]; imagePath?: string; imageFileId?: string; imageAsset?: ProductImageAsset; capturedAt?: string };
export type Review = { asin: string; star: number; date: string; text: string };
export type Supplier = { title: string; price: string; moq: string; shopName: string; url: string };
export type Tag = { asin: string; tag: string; quote: string; source: "dictionary" | "cloud" };
export type TagsResult = { matches: Tag[]; countByTag: Record<string, number>; countByAsin: Record<string, Record<string, number>> };
export type Draft = { quality?: import("./quality").SelectionQuality; schemaVersion: 1; fixture?: boolean; slug: string; brief: Brief; competitors: Competitor[]; suppliers: Supplier[]; tags: TagsResult; product: Product & { workbookDetail: Record<string, unknown> } };

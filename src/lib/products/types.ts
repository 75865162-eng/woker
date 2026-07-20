export type ProductStatus = "pending" | "developing" | "ops_review" | "listed" | "canceled" | "delisted" | "patent_risk";

export type ProductSizeCm = {
  length: number;
  width: number;
  height: number;
};

export type Product = {
  id: string;
  sku: string;
  chineseName: string;
  englishName: string;
  asin: string;
  developer: string;
  purchasePrice: number;
  status: ProductStatus;
  supplierName: string;
  supplierUrl: string;
  specs: string;
  purchaseLeadTime: string;
  createdAt: string;
  keywords: string;
  note: string;
  cancelReason: string;
  hsCode: string;
  images: string[];
  competitorAsins: string[];
  productWeightG: number;
  packageWeightG: number;
  productSizeCm: ProductSizeCm;
  packageSizeCm: ProductSizeCm;
};

export type ProductDraft = Omit<Product, "id"> & {
  id?: string;
};

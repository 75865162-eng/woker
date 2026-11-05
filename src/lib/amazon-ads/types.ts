export type AdsStatus = "enabled" | "paused" | "archived";
export type AdType = "SP" | "SB" | "SD";
export type AdsEntity = "campaigns" | "ad-groups" | "keywords" | "targets" | "negatives" | "search-terms" | "placements" | "products";
export type Metric = "impressions" | "clicks" | "ctr" | "spend" | "cpc" | "orders" | "sales" | "acos" | "roas" | "conversion";
export interface Facts { impressions: number; clicks: number; spend: number; orders: number; sales: number }
export type Metrics = Facts & { ctr: number; cpc: number; acos: number; roas: number; conversion: number };
export interface AdsRow extends Metrics {
  id: string; name: string; status: AdsStatus; adType: AdType; campaignId: string; campaign: string;
  adGroupId?: string; adGroup?: string; budget?: number; bid?: number; match?: string; expression?: string;
  start: string; end: string; kind?: string; trigger?: string;
  /** Present only for records created in the isolated UI session. */
  entity?: AdsEntity;
}
export interface AdsScope { account: string; marketplace: string }
export interface DateRange { from: string; to: string }
export interface AdsQuery extends AdsScope, DateRange { entity: AdsEntity; campaignId?: string; adGroupId?: string; adType?: AdType }
export interface AdsDataset { rows: AdsRow[]; trend: Array<Metrics & { date: string }>; total: Metrics }
// Keep the UI independent of transport. A future authenticated provider can implement this contract.
export interface AdsDataProvider { read(query: AdsQuery): AdsDataset }
export interface AdsReport { id: string; name: string; type: AdsEntity; adType: AdType; from: string; to: string; status: "ready" | "generating" | "failed"; createdAt: string; account: string; marketplace: string }

"use client";



export const pageSize = 10;

export const detailPageSize = 25;

export const dragMimeType = "application/x-campaign-group-id";

export type CampaignSortKey = "campaignName" | "adGroupName" | "overallCsv";

export type CampaignSortDirection = "asc" | "desc";

export type DetailSortKey =
  | "keyword"
  | "adGroupName"
  | "sheetName"
  | "matchType"
  | "currentBid"
  | "impressions"
  | "clicks"
  | "orders"
  | "sales"
  | "spend";

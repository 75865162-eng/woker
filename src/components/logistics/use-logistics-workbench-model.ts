"use client";

import type { LogisticsTemplateOption, LogisticsWorkspaceState } from "@/lib/logistics/types";

export const SLOW_PARSE_WARNING_BYTES = 30 * 1024 * 1024;

export const initialState: LogisticsWorkspaceState = {
  aFile: null,
  bFile: null,
  saihuFile: null,
  cFile: null,
  dFile: null,
  pdfFiles: [],
  aSummary: null,
  bSummary: null,
  saihuSummary: null,
  cSummary: null,
  dSummary: null,
  pdfSummaries: [],
  bExport: null,
  saihuExport: null,
  cExport: null,
  cError: null,
  summaryExport: null,
  compareExport: null,
  dExports: [],
  selectedLogisticsTemplate: "kaiqi",
  logs: [],
};

export const logisticsTemplateOptions: LogisticsTemplateOption[] = [
  { id: "kaiqi", label: "凯奇", enabled: true },
  { id: "weitu", label: "为途", enabled: false },
  { id: "changhe", label: "长河", enabled: false },
  { id: "pending-4", label: "4待定", enabled: false },
  { id: "pending-5", label: "5待定", enabled: false },
  { id: "pending-6", label: "6待定", enabled: false },
];

export type FileSlot = "a" | "b" | "saihu" | "c" | "d" | "pdf";

import type { Product } from "@/lib/products/types";
import { overdueThresholdDays, type TrialPriceRow } from "./product-workbench-model";

const SKU_NUMERIC_LIMIT = 10_000;
const SKU_SUFFIX_LIMIT = 999;

function lettersToIndex(letters: string) {
  let value = 0;
  for (const char of letters) {
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return value - 1;
}

function indexToLetters(index: number) {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function parseSkuSequence(sku: string) {
  const normalized = sku.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const match = /^([A-Z]+)(\d{3})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const prefixIndex = lettersToIndex(match[1]);
  const suffix = Number(match[2]);
  if (!Number.isFinite(prefixIndex) || !Number.isFinite(suffix) || suffix < 1 || suffix > SKU_SUFFIX_LIMIT) {
    return null;
  }

  return SKU_NUMERIC_LIMIT + prefixIndex * SKU_SUFFIX_LIMIT + (suffix - 1);
}

export function formatSkuSequence(sequence: number) {
  if (sequence < SKU_NUMERIC_LIMIT) {
    return String(sequence).padStart(4, "0");
  }

  const offset = sequence - SKU_NUMERIC_LIMIT;
  const prefixIndex = Math.floor(offset / SKU_SUFFIX_LIMIT);
  const suffix = (offset % SKU_SUFFIX_LIMIT) + 1;
  return `${indexToLetters(prefixIndex)}${String(suffix).padStart(3, "0")}`;
}

export function calculateExcelPricing(row: TrialPriceRow) {
  const volumeWeightKg = (row.lengthCm * row.widthCm * row.heightCm) / 6000;
  const lengthIn = row.lengthCm / 2.54;
  const widthIn = row.widthCm / 2.54;
  const heightIn = row.heightCm / 2.54;
  const actualWeightLb = row.actualWeightKg * 2.2;
  const volumeWeightLbFromCm = volumeWeightKg * 2.2;
  const volumeWeightLb = (lengthIn * widthIn * heightIn) / 139;
  const fbaBillableWeightLb = Math.max(actualWeightLb, volumeWeightLb);
  const oceanFreight = (Math.max(actualWeightLb, volumeWeightLbFromCm) / 2.2) * (row.oceanFreightUnitPrice || 0);
  const commission = row.suggestedPrice * 0.15;
  const fuelFee = row.fbaFee * 0.035;
  const monthlyStorageFee = lengthIn * widthIn * heightIn * 0.000578 * 0.87;
  const breakEvenPrice = row.exchangeRate
    ? (row.purchaseCost + oceanFreight) / row.exchangeRate + commission + row.fbaFee + fuelFee + monthlyStorageFee
    : 0;
  const profit = row.suggestedPrice - breakEvenPrice;
  const profitRate = row.suggestedPrice ? profit / row.suggestedPrice : 0;

  return {
    volumeWeightKg,
    lengthIn,
    widthIn,
    heightIn,
    actualWeightLb,
    volumeWeightLbFromCm,
    volumeWeightLb,
    fbaBillableWeightLb,
    oceanFreight,
    commission,
    fuelFee,
    monthlyStorageFee,
    breakEvenPrice,
    profit,
    profitRate,
  };
}

export function calculateTrialPricing(row: TrialPriceRow) {
  const volumeWeightKg = (row.lengthCm * row.widthCm * row.heightCm) / 6000;
  const billableWeight = Math.max(row.actualWeightKg, volumeWeightKg);
  const fuelFee = row.fbaFee * 0.035;
  const oceanFreight = billableWeight * (row.oceanFreightUnitPrice || 0);
  const commission = row.suggestedPrice * 0.15;
  const monthlyStorageFee = (row.lengthCm / 2.54) * (row.widthCm / 2.54) * (row.heightCm / 2.54) * 0.000578 * 0.87;
  const breakEvenPrice = row.exchangeRate ? (row.purchaseCost + oceanFreight) / row.exchangeRate + commission + row.fbaFee + monthlyStorageFee : 0;
  const profit = row.suggestedPrice - breakEvenPrice;
  const profitRate = row.suggestedPrice ? profit / row.suggestedPrice : 0;
  const volumeWeightLb = (row.lengthCm / 2.54) * (row.widthCm / 2.54) * (row.heightCm / 2.54) / 139;
  const actualWeightLb = row.actualWeightKg * 2.205;
  const lightFreight = volumeWeightLb > 3 ? ((volumeWeightLb - 3) * 16) / 4 * 0.08 + 6.92 : 0;
  const heavyFreight = actualWeightLb > 3 ? ((actualWeightLb - 3) * 16) / 4 * 0.08 + 6.92 : 0;
  const oversizeFreight = actualWeightLb - 1 * 0.38 + 9.61;

  return {
    volumeWeightKg,
    fuelFee,
    oceanFreight,
    commission,
    monthlyStorageFee,
    breakEvenPrice,
    profit,
    profitRate,
    volumeWeightLb,
    actualWeightLb,
    lightFreight,
    heavyFreight,
    oversizeFreight,
  };
}

export function isOverdueProduct(product: Product) {
  if (["listed", "canceled", "delisted", "patent_risk"].includes(product.status)) {
    return false;
  }

  const createdAt = new Date(product.createdAt.includes(" ") ? product.createdAt.replace(" ", "T") : `${product.createdAt}T00:00:00`);
  if (Number.isNaN(createdAt.getTime())) {
    return false;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const elapsedDays = Math.floor((todayStart.getTime() - createdAt.getTime()) / 86_400_000);

  return elapsedDays > overdueThresholdDays;
}

export function nextSku(products: Array<Pick<Product, "sku">>) {
  const max = products.reduce((currentMax, product) => {
    const sequence = parseSkuSequence(product.sku);
    return sequence === null ? currentMax : Math.max(currentMax, sequence);
  }, -1);

  return formatSkuSequence(max + 1);
}

export function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function buildAmazonLink(asin: string) {
  const normalized = asin.trim();
  return normalized ? `https://www.amazon.com/dp/${encodeURIComponent(normalized)}` : "";
}

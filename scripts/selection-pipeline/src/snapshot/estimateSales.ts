// Original heuristic using a power-law rank curve, NOT a calibrated category sales model.
// No external formula/data copied. BSR varies by category/time: never treat this as real sales.
export function estimateSales(bsr?: number | null): number | null {
  return bsr && Number.isFinite(bsr) && bsr > 0 ? Math.max(1, Math.round(100000 / Math.pow(bsr, 0.75))) : null;
}

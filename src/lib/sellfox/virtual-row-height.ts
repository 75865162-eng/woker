/**
 * 赛狐复刻表格的虚拟行高估算。
 *
 * 依据：sellfox-ui.css 中单元格 padding 为 8px(上下) + line-height 20px，
 * 单行文本行高 ≈ 36px；`.sf-stack` 为两行 18px = 36px + 16px padding = 52px；
 * 含 `.sf-thumb`（48px 缩略图）的行 = 48px + 16px padding = 64px。
 * 同一张表的列结构是固定的，因此按“是否存在更高类型的列”即可确定全表统一行高，
 * 这是安全接入 useVirtualRows（固定行高假设）的前提。
 */

export type RowHeightColumn = { kind?: string };

const STACK_KINDS = new Set([
  "store", "mskuPrice", "skuName", "titleAsin", "asinMsku", "stack",
]);

export function estimateReplicaRowHeight(columns: readonly RowHeightColumn[]): number {
  if (columns.some((c) => c.kind === "image")) return 64;
  if (columns.some((c) => c.kind && STACK_KINDS.has(c.kind))) return 52;
  return 40;
}

/** 行数为 0 时不启用虚拟；小页（<= 阈值）保留原全量渲染，避免影响常规交互与可访问性。 */
export function shouldVirtualizeRows(rowCount: number, threshold = 40): boolean {
  return rowCount > threshold;
}

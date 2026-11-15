import {requireText,strictKeys,WmsInputError} from '@/lib/wms/rules';
import {shipmentLabelKinds,type ShipmentLabelKind} from './shipment-label-contract';

export type ShipmentLabelRequest = {
  shipmentId: string;
  kind: ShipmentLabelKind;
  idempotencyKey: string;
  boxNumbers?: string[];
};

/** Strict allow-list parser. Unknown fields are rejected; no Amazon-generated codes are accepted. */
export function parseShipmentLabelRequest(raw: unknown): ShipmentLabelRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsInputError('标签请求内容须为对象。');
  const value = raw as Record<string, unknown>;
  strictKeys(value, ['shipmentId', 'kind', 'boxNumbers', 'idempotencyKey']);
  if (typeof value.kind !== 'string' || !shipmentLabelKinds.includes(value.kind as ShipmentLabelKind)) throw new WmsInputError('标签类型无效。');
  const request: ShipmentLabelRequest = {
    shipmentId: requireText(value.shipmentId, '货件 ID'),
    kind: value.kind as ShipmentLabelKind,
    idempotencyKey: requireText(value.idempotencyKey, '幂等键'),
  };
  if (value.boxNumbers !== undefined && value.boxNumbers !== null) {
    if (!Array.isArray(value.boxNumbers) || value.boxNumbers.length < 1 || value.boxNumbers.length > 200) throw new WmsInputError('标签箱号数量须为 1-200。');
    request.boxNumbers = [...new Set(value.boxNumbers.map(number => requireText(number, '箱号', 60)))].sort();
  }
  return request;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]!));
}

export type ShipmentLabelBox = {
  number: string;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
  grossWeightKg?: string;
  items: Array<{sellerSku?: string; fnsku?: string; quantity: number}>;
};

export type ShipmentLabelRenderInput = {
  planNumber: string;
  shipmentName: string;
  kind: ShipmentLabelKind;
  boxes: ShipmentLabelBox[];
  generatedAt: string;
};

const PRINT_CSS = [
  ':root{color-scheme:light}',
  '*{box-sizing:border-box}',
  'body{font:14px/1.5 -apple-system,"Segoe UI",sans-serif;margin:24px;color:#111}',
  '.label{border:2px solid #111;padding:18px;margin:0 0 24px;break-inside:avoid;page-break-inside:avoid}',
  '.banner{background:#fff3cd;border:2px solid #b45309;color:#7c2d12;font-weight:700;font-size:18px;padding:10px 14px;margin:0 0 12px;text-align:center;letter-spacing:1px}',
  'h1{font-size:20px;margin:0 0 12px}',
  'h2{font-size:15px;margin:16px 0 8px}',
  '.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 18px;margin:0 0 12px}',
  '.meta>div{display:flex;gap:8px;border-bottom:1px dotted #bbb;padding:4px 0}',
  '.meta dt{color:#555;min-width:120px}',
  '.meta dd{margin:0;font-weight:600}',
  '.box-no{font-size:22px}',
  '.summary{background:#f3f4f6;padding:8px 10px;border-radius:4px;margin:0 0 8px}',
  'table{border-collapse:collapse;width:100%}',
  'th,td{border:1px solid #888;padding:8px 10px;text-align:left}',
  'th{background:#f3f4f6}',
  'td.qty{font-weight:700}',
  '.note{color:#555;font-size:12px;margin:14px 0 0;border-top:1px dashed #ccc;padding-top:8px}',
  '@page{size:A4;margin:10mm}',
  '@media print{body{margin:0}.label{border:2px solid #111;margin:0;break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid}.label:last-child{break-after:auto;page-break-after:auto}table tr{break-inside:avoid;page-break-inside:avoid}}',
].join('');

/**
 * Pure renderer for local internal labels. Every dynamic value is HTML-escaped;
 * one box per printed page; no Amazon-generated box/placement/warehouse codes are
 * emitted. Zero IO (no prisma / env / crypto imports).
 */
export function renderShipmentLabels(input: ShipmentLabelRenderInput): string {
  const {planNumber, shipmentName, kind, boxes, generatedAt} = input;
  const esc = escapeHtml;
  const kindLabel = kind === 'ITEM_LABEL' ? '商品标签' : '箱唛';
  const itemsHeading = kind === 'ITEM_LABEL' ? '商品标签明细（逐条）' : '箱内商品明细';
  const lineCount = boxes.reduce((sum, box) => sum + box.items.length, 0);
  const totalQuantity = boxes.reduce((sum, box) => sum + box.items.reduce((inner, item) => inner + (Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0), 0), 0);
  const banner = '内部标签，非 Amazon 官方箱唛';
  const note = '字段均取自本地装箱与货件只读数据，不含任何 Amazon 官方生成字段；仅供内部核对，浏览器 Ctrl+P 打印或另存 PDF。';
  const sections = boxes.map(box => {
    const rows = box.items.length
      ? box.items.map((item, index) => `<tr><td>${esc(index + 1)}</td><td>${esc(item.sellerSku)}</td><td>${esc(item.fnsku)}</td><td class="qty">${esc(item.quantity)}</td></tr>`).join('')
      : '<tr><td colspan="4">无商品明细</td></tr>';
    return '<section class="label">'
      + `<p class="banner">${esc(banner)}</p>`
      + `<h1>本地内部标签 · ${esc(kindLabel)}</h1>`
      + '<dl class="meta">'
      + `<div><dt>计划单号</dt><dd>${esc(planNumber)}</dd></div>`
      + `<div><dt>货件号</dt><dd>${esc(shipmentName)}</dd></div>`
      + `<div><dt>生成时间</dt><dd>${esc(generatedAt)}</dd></div>`
      + `<div><dt>本地箱号</dt><dd class="box-no">${esc(box.number)}</dd></div>`
      + `<div><dt>尺寸（长×宽×高 cm）</dt><dd>${esc(box.lengthCm ?? '—')} × ${esc(box.widthCm ?? '—')} × ${esc(box.heightCm ?? '—')}</dd></div>`
      + `<div><dt>毛重（kg）</dt><dd>${esc(box.grossWeightKg ?? '—')}</dd></div>`
      + '</dl>'
      + `<p class="summary">内容摘要：全单共 ${esc(boxes.length)} 箱 / ${esc(lineCount)} 条商品明细 / 合计 ${esc(totalQuantity)} 件；本箱 ${esc(box.items.length)} 条明细。</p>`
      + `<h2>${esc(itemsHeading)}</h2>`
      + `<table><thead><tr><th>#</th><th>SKU</th><th>FNSKU</th><th>数量</th></tr></thead><tbody>${rows}</tbody></table>`
      + `<p class="note">${esc(note)}</p>`
      + '</section>';
  }).join('');
  const title = `本地内部标签 - ${kindLabel} - ${planNumber}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${sections}</body></html>`;
}

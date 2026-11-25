import { createHash } from 'node:crypto';

/** 多平台统一主数据映射内核（报告2 P2-3）：以 wokerSku 为核心，映射各平台 sellerSku/asin。
 * 红线：映射须有置信度与依据；冲突（同一平台SKU映射到多个 wokerSku）阻断不臆造；
 * sellerSku 兜底 wearing 一律标低置信度，绝不静默归并。 */
export type Platform = 'AMAZON' | 'SELLFOX' | 'WALMART' | 'TEMU';
const PLATFORMS: Platform[] = ['AMAZON', 'SELLFOX', 'WALMART', 'TEMU'];
export type SkuMapping = {
  platform: Platform; sellerSku: string; asin: string | null; wokerSku: string;
  confidence: 'EXACT' | 'HIGH' | 'LOW'; evidence: string;
};

export type MapError = Error & { code: string };
function fail(code: string, msg: string): never { const e = new Error(msg) as MapError; e.code = code; throw e; }

export function resolveSkuMap(mappings: readonly SkuMapping[]) {
  if (!mappings.length) return { resolved: [] as { platform: Platform; sellerSku: string; wokerSku: string; confidence: string }[], conflicts: [] as string[], lowConfidence: [] as string[] };
  const byPlatformSku = new Map<string, SkuMapping[]>();
  const byWoker = new Map<string, Set<string>>();
  for (const m of mappings) {
    if (!PLATFORMS.includes(m.platform)) fail('INVALID_PLATFORM', '平台无效');
    if (!m.sellerSku?.trim() || !m.wokerSku?.trim()) fail('MISSING_SKU', 'sellerSku 与 wokerSku 均须提供');
    if (!['EXACT', 'HIGH', 'LOW'].includes(m.confidence)) fail('INVALID_CONFIDENCE', '置信度无效');
    if (!m.evidence?.trim()) fail('MISSING_EVIDENCE', '映射须提供依据，禁止无依据归并');
    const k = `${m.platform}|${m.sellerSku}`;
    byPlatformSku.set(k, [...(byPlatformSku.get(k) ?? []), m]);
    const set = byWoker.get(m.wokerSku) ?? new Set();
    set.add(`${m.platform}|${m.sellerSku}`); byWoker.set(m.wokerSku, set);
  }
  const resolved: { platform: Platform; sellerSku: string; wokerSku: string; confidence: string }[] = [];
  const conflicts: string[] = [];
  const lowConfidence: string[] = [];
  for (const [k, rows] of byPlatformSku) {
    const distinctWoker = new Set(rows.map(r => r.wokerSku));
    if (distinctWoker.size > 1) { conflicts.push(k); continue; } // 冲突阻断
    // 同组取置信度最高的一条（EXACT > HIGH > LOW）
    const rank = { EXACT: 3, HIGH: 2, LOW: 1 };
    const best = [...rows].sort((a, b) => rank[b.confidence] - rank[a.confidence])[0];
    resolved.push({ platform: best.platform, sellerSku: best.sellerSku, wokerSku: best.wokerSku, confidence: best.confidence });
    if (best.confidence === 'LOW') lowConfidence.push(k);
  }
  // 全局一致性：一个 wokerSku 在同一平台对应多个 sellerSku 属正常（多变体），跨 wokerSku 的 sellerSku 冲突已在上面拦截
  const digest = createHash('sha256').update(JSON.stringify(resolved.map(r => [r.platform, r.sellerSku, r.wokerSku, r.confidence]))).digest('hex');
  return { resolved, conflicts, lowConfidence, digest };
}

/** 订单兜底解析：优先显式映射，无映射时以 sellerSku??asin 低置信度兜底并标记，绝不静默当作 EXACT。 */
export function resolveOrderSku(params: {
  platform: Platform; sellerSku: string | null; asin: string | null;
  mappings: readonly SkuMapping[];
}) {
  const map = resolveSkuMap(params.mappings);
  if (map.conflicts.includes(`${params.platform}|${params.sellerSku ?? ''}`)) {
    return { wokerSku: null, confidence: 'BLOCKED', reason: '映射冲突，禁止归并' };
  }
  const hit = map.resolved.find(r => r.platform === params.platform && r.sellerSku === params.sellerSku);
  if (hit) return { wokerSku: hit.wokerSku, confidence: hit.confidence, reason: '显式映射' };
  const fallback = params.sellerSku ?? params.asin;
  if (!fallback) return { wokerSku: null, confidence: 'NONE', reason: '无 sellerSku 与 asin，无法归并' };
  return { wokerSku: fallback, confidence: 'LOW', reason: '兜底：sellerSku/asin 直接作为 sku，需人工确认' };
}

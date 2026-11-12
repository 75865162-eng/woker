import { createHash } from 'node:crypto';
import { AdsQueryError } from './query-contract';

export type AdsBusinessPatch = { state?: 'ENABLED' | 'PAUSED' | 'ARCHIVED'; name?: string; bid?: string; dailyBudget?: string; placements?: Array<{ placement: 'PLACEMENT_TOP' | 'PLACEMENT_PRODUCT_PAGE' | 'PLACEMENT_REST_OF_SEARCH'; percentage: number }> };
const supported: Record<string, readonly string[]> = {
  'SP:campaign': ['state', 'name', 'dailyBudget', 'placements'],
  'SP:ad-group': ['state', 'name', 'bid'], 'SP:keyword': ['state', 'bid'], 'SP:target': ['state', 'bid'],
  'SP:product-ad': ['state'], 'SP:negative-keyword': ['state'], 'SP:negative-target': ['state'],
  'SP:campaign-negative-keyword': ['state'], 'SP:campaign-negative-target': ['state'],
};
export function adsBusinessPatchFields(entityType: string) { return supported[entityType] ?? []; }
export function parseAdsBusinessPatch(entityType: string, value: unknown): AdsBusinessPatch {
  const keys = supported[entityType];
  if (!keys || !value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !keys.includes(key))) throw new AdsQueryError('此实体或变更字段尚未核实。', 422);
  const patch = value as AdsBusinessPatch;
  if (patch.state !== undefined && !['ENABLED', 'PAUSED', 'ARCHIVED'].includes(patch.state)) throw new AdsQueryError('广告状态无效。', 422);
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 200)) throw new AdsQueryError('广告名称无效。', 422);
  for (const key of ['bid', 'dailyBudget'] as const) if (patch[key] !== undefined && (typeof patch[key] !== 'string' || !/^\d{1,8}(?:\.\d{1,6})?$/.test(patch[key]) || !/[1-9]/.test(patch[key]))) throw new AdsQueryError('竞价/预算须为正数十进制文本。', 422);
  if (patch.placements !== undefined) {
    if (!Array.isArray(patch.placements) || !patch.placements.length || patch.placements.length > 3 || new Set(patch.placements.map(row => row?.placement)).size !== patch.placements.length || patch.placements.some(row => !row || Object.keys(row).some(key => !['placement', 'percentage'].includes(key)) || !['PLACEMENT_TOP', 'PLACEMENT_PRODUCT_PAGE', 'PLACEMENT_REST_OF_SEARCH'].includes(row.placement) || !Number.isInteger(row.percentage) || row.percentage < 0 || row.percentage > 900)) throw new AdsQueryError('展示位置调整无效。', 422);
  }
  // This is a target ERP draft, never an unverified Amazon HTTP request.
  return { ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) };
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
export function adsBusinessFingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
export function assertAdsDraftTransition(status: string, action: string, actor: string, creator: string) {
  const next = action === 'submit' && status === 'DRAFT' ? 'SUBMITTED' : action === 'approve' && status === 'SUBMITTED' ? 'APPROVED' : action === 'reject' && status === 'SUBMITTED' ? 'REJECTED' : action === 'cancel' && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(status) ? 'CANCELLED' : null;
  if (!next) throw new AdsQueryError('广告草稿状态不允许此操作。', 409);
  if (['approve', 'reject'].includes(action) ? actor === creator : actor !== creator) throw new AdsQueryError('广告草稿申请与审核必须由不同人员完成，提交/取消限原申请人。', 403);
  return next;
}

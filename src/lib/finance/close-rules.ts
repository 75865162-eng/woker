import { createHash } from 'node:crypto';
import { WmsError } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';
import { closeDomains, type CloseDomain, type ClosePolicy } from './close-contract';
export { closeDomains, type CloseDomain, type ClosePolicy } from './close-contract';
export function closeDigest(value: unknown) {
  // Normalize JSONB key ordering while retaining meaningful array order and JSON value types.
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return input;
  }
  return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex');
}
export function parseClosePolicy(raw: unknown): ClosePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsError('须提供目标端关账制度配置。', 422);
  const input = raw as Record<string, unknown>;
  strictKeys(input, ['reference', 'requiredDomains', 'allowReopen']);
  const reference = requireText(input.reference, '目标端制度依据', 1000);
  const required = input.requiredDomains;
  if (typeof input.allowReopen !== 'boolean' || !Array.isArray(input.requiredDomains) || input.requiredDomains.length !== closeDomains.length || new Set(input.requiredDomains).size !== closeDomains.length || closeDomains.some(domain => !(required as unknown[]).includes(domain))) throw new WmsError('须明确全部来源域的核对责任和反结账制度；无业务的域须在核对证据中说明不适用。', 422);
  return { reference, requiredDomains: [...closeDomains], allowReopen: input.allowReopen };
}
export function parseCloseEvidence(raw: unknown, policy: ClosePolicy) {
  if (!Array.isArray(raw) || raw.length !== policy.requiredDomains.length) throw new WmsError('须逐域提交完整性核对证据。', 422);
  const seen = new Set<string>();
  const rows = raw.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new WmsError('核对证据无效。', 400);
    const input = row as Record<string, unknown>;
    strictKeys(input, ['domain', 'status', 'evidence']);
    if (!policy.requiredDomains.includes(input.domain as CloseDomain) || seen.has(String(input.domain)) || !['RECONCILED', 'NOT_APPLICABLE'].includes(String(input.status))) throw new WmsError('核对域重复、缺失或尚未完成。', 422);
    seen.add(String(input.domain));
    return { domain: input.domain as CloseDomain, status: input.status as 'RECONCILED' | 'NOT_APPLICABLE', evidence: requireText(input.evidence, '核对依据及范围', 2000) };
  });
  return rows.sort((a, b) => a.domain.localeCompare(b.domain));
}

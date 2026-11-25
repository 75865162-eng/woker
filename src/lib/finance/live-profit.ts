import { createHash } from 'node:crypto';

/** 实时增量利润流内核（报告1 阶段3 / 报告2 P3）：订单/广告/费用事件 → 增量更新利润。
 * 红线：未确认来源进 pendingSources，不展示为最终利润；水位线单调；幂等（同 eventKey 不重复计入）；
 * 不跨币种混算；缺项不补零。对标赛狐"订单一变利润即更新"，但保持可审计与 fail-closed。 */
const S = 1_000_000n, Z = 0n;
export type LiveProfitError = Error & { code: string };
function fail(code: string, msg: string): never { const e = new Error(msg) as LiveProfitError; e.code = code; throw e; }
function dec(v: unknown, label: string): bigint {
  if (typeof v !== 'string' || !/^-?\d+(\.\d{1,6})?$/.test(v.trim())) fail('INVALID_AMOUNT', `${label} 须为 6 位定点字符串`);
  const neg = v.trim().startsWith('-'), [i, f = ''] = v.trim().replace('-', '').split('.');
  const x = BigInt(i) * S + BigInt(f.padEnd(6, '0')); return neg ? -x : x;
}
const fmt = (v: bigint) => { const neg = v < Z, a = neg ? -v : v; return `${neg ? '-' : ''}${a / S}.${(a % S).toString().padStart(6, '0')}`; };

export type ProfitEvent = {
  eventKey: string; kind: 'ORDER' | 'ADS_SPEND' | 'FEE' | 'REFUND';
  currency: string; amount: string; occurredAt: string; confirmed: boolean; sourceRunId: string;
};
export type ProfitState = {
  revenue: bigint; ads: bigint; fees: bigint; refunds: bigint;
  watermark: string; seen: Set<string>; pendingSources: Set<string>;
};

export function emptyProfitState(watermark = ''): ProfitState {
  return { revenue: Z, ads: Z, fees: Z, refunds: Z, watermark, seen: new Set(), pendingSources: new Set() };
}

/** 增量应用事件：返回是否为最终态（所有来源已确认）+ 当前利润。幂等、水位单调。 */
export function applyProfitEvents(state: ProfitState, events: readonly ProfitEvent[], currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) fail('INVALID_CURRENCY', '币种无效');
  let changed = false;
  for (const ev of events) {
    if (ev.currency !== currency) fail('CROSS_CURRENCY', `事件 ${ev.eventKey} 币种与利润币种不同，禁止混算`);
    if (typeof ev.occurredAt !== 'string' || !ev.occurredAt) fail('INVALID_TIME', '事件须有发生时点');
    if (state.seen.has(ev.eventKey)) continue; // 幂等
    const amt = dec(ev.amount, ev.eventKey);
    switch (ev.kind) {
      case 'ORDER': state.revenue += amt; break;
      case 'ADS_SPEND': state.ads += amt; break;
      case 'FEE': state.fees += amt; break;
      case 'REFUND': state.refunds += amt; break;
      default: fail('INVALID_KIND', '事件类型无效');
    }
    state.seen.add(ev.eventKey);
    if (!ev.confirmed) state.pendingSources.add(ev.sourceRunId);
    else state.pendingSources.delete(ev.sourceRunId);
    changed = true;
  }
  // 水位单调：仅前进不回退
  const maxTs = events.reduce((m, e) => e.occurredAt > m ? e.occurredAt : m, state.watermark);
  if (maxTs > state.watermark) state.watermark = maxTs;
  const net = state.revenue - state.ads - state.fees - state.refunds;
  const final = state.pendingSources.size === 0;
  return {
    changed, final,
    profit: fmt(net),
    components: { revenue: fmt(state.revenue), ads: fmt(state.ads), fees: fmt(state.fees), refunds: fmt(state.refunds) },
    pendingSources: [...state.pendingSources].sort(),
    watermark: state.watermark,
    digest: createHash('sha256').update(JSON.stringify({ net: fmt(net), ts: state.watermark, pending: [...state.pendingSources].sort() })).digest('hex'),
  };
}

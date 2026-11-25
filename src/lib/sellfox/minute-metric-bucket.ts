import { createHash } from 'node:crypto';

/** 分钟级指标聚合桶（报告1 阶段3）：把带分钟的广告事件聚合为分钟桶，供自动调价规则联动。
 * 红线：事件须带 UTC 分钟时间戳与明确币种；缺值不补零；跨币种不混算；桶键含维度防串；缺分钟不插值。 */
export type MinuteEvent = {
  ts: string; // ISO 8601，精确到分钟
  dimensionKey: string; // store|adType|entityType|entityId
  currency: string;
  impressions: number; clicks: number; cost: string; sales: string; orders: number;
};
export type MinuteBucket = {
  minute: string; dimensionKey: string; currency: string;
  impressions: number; clicks: number; costMicros: bigint; salesMicros: bigint; orders: number;
  eventCount: number; ctrBp: number | null; acosBp: number | null;
};

const MICRO = 1_000_000n;
export class MinuteBucketError extends Error { constructor(msg: string) { super(msg); this.name = 'MinuteBucketError'; } }
function micros(v: string | number): bigint {
  const s = typeof v === 'number' ? v.toFixed(6) : v;
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new MinuteBucketError('金额须为非负 6 位定点');
  const [i, f = ''] = s.split('.'); return BigInt(i) * MICRO + BigInt(f.padEnd(6, '0'));
}
function minuteOf(ts: string): string {
  if (typeof ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(ts)) throw new MinuteBucketError('事件时间戳无效，须含分钟');
  const d = new Date(ts); if (isNaN(d.getTime())) throw new MinuteBucketError('时间戳不可解析');
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM (UTC)
}

export function aggregateMinuteBuckets(events: readonly MinuteEvent[]) {
  if (!Array.isArray(events)) throw new MinuteBucketError('事件列表无效');
  const grouped = new Map<string, { bucket: MinuteBucket }>();
  for (const e of events) {
    if (!e.dimensionKey?.trim()) throw new MinuteBucketError('事件缺维度键，禁止聚合');
    if (!/^[A-Z]{3}$/.test(e.currency)) throw new MinuteBucketError('事件币种无效');
    const minute = minuteOf(e.ts);
    const key = `${minute}|${e.dimensionKey}|${e.currency}`;
    let g = grouped.get(key);
    if (!g) {
      g = { bucket: { minute, dimensionKey: e.dimensionKey, currency: e.currency,
        impressions: 0, clicks: 0, costMicros: 0n, salesMicros: 0n, orders: 0, eventCount: 0, ctrBp: null, acosBp: null } };
      grouped.set(key, g);
    }
    const b = g.bucket;
    if (!Number.isSafeInteger(e.impressions) || !Number.isSafeInteger(e.clicks) || !Number.isSafeInteger(e.orders) || e.impressions < 0 || e.clicks < 0 || e.orders < 0) throw new MinuteBucketError('计数须为非负整数');
    b.impressions += e.impressions; b.clicks += e.clicks; b.orders += e.orders;
    b.costMicros += micros(e.cost); b.salesMicros += micros(e.sales); b.eventCount++;
  }
  const buckets = [...grouped.values()].map(({ bucket: b }) => {
    // 比率先求和后算，按万分比；分母为 0 时 null（不臆造）
    b.ctrBp = b.impressions > 0 ? Math.round(b.clicks / b.impressions * 10000) : null;
    b.acosBp = b.salesMicros > 0n ? Number(b.costMicros * 10000n / b.salesMicros) : null;
    return b;
  }).sort((a, b) => a.minute.localeCompare(b.minute) || a.dimensionKey.localeCompare(b.dimensionKey));
  const digest = createHash('sha256').update(JSON.stringify(buckets.map(b => [b.minute, b.dimensionKey, b.currency, b.costMicros.toString(), b.salesMicros.toString()]))).digest('hex');
  return { buckets, bucketCount: buckets.length, digest, note: '分钟桶不插值：无事件的分钟不生成桶。' };
}

/** 自动调价规则取窗口内聚合（连续 N 分钟），窗口无数据返回 NEEDS_DATA 而非补零。 */
export function windowAggregate(buckets: readonly MinuteBucket[], minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1) throw new MinuteBucketError('窗口分钟数无效');
  if (!buckets.length) return { status: 'NEEDS_DATA' as const, buckets: [], cost: '0', sales: '0' };
  const last = buckets[buckets.length - 1];
  const end = new Date(last.minute + ':00Z').getTime();
  const start = end - minutes * 60_000;
  const inWindow = buckets.filter(b => { const t = new Date(b.minute + ':00Z').getTime(); return t >= start && t <= end; });
  const cost = inWindow.reduce((s, b) => s + b.costMicros, 0n);
  const sales = inWindow.reduce((s, b) => s + b.salesMicros, 0n);
  return { status: 'READY' as const, buckets: inWindow, cost: (cost / MICRO).toString(), sales: (sales / MICRO).toString() };
}

/**
 * 有界 LRU 缓存：容量上限 + TTL 过期 + 惰性清理。
 *
 * 用于替换此前散落在各模块、无容量上限的 `new Map()` 结果缓存。
 * 命中即移到队尾（最近使用），写入时清理过期项并按上限淘汰最久未命中的键，
 * 保证长时间运行的 Node / 浏览器进程不会因为只读快照缓存无限增长。
 *
 * 安全约束：本工具只缓存只读数据；任何写路径失效由调用方显式 delete/clear 完成。
 */

export type LruMapOptions = {
  /** 最大保留条目数，达到上限后淘汰最久未命中的键。必须 >= 1。 */
  maxEntries: number;
  /** 默认时钟，便于测试注入单调时钟。 */
  now?: () => number;
};

type Entry<V> = { value: V; expiresAt: number };

export class LruMap<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly clock: () => number;

  constructor(options: LruMapOptions) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.clock = options.now ?? Date.now;
  }

  get size(): number {
    return this.store.size;
  }

  /** 读取；过期项即时删除并返回 undefined；命中移到队尾实现 LRU。 */
  get(key: string, now: number = this.clock()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** 写入；ttlMs <= 0 表示永不过期（仍受容量上限约束）。 */
  set(key: string, value: V, ttlMs = 0, now: number = this.clock()): void {
    this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: ttlMs > 0 ? now + ttlMs : Number.POSITIVE_INFINITY,
    });
    this.pruneExpired(now);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  /** 主动清理全部过期项，返回清理数量。 */
  pruneExpired(now: number = this.clock()): number {
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

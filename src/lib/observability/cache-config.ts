/**
 * 缓存配置自检快照（纯函数，只读 env，无 IO）。
 *
 * 目的：模板默认全关（.env.example / deploy/production.env.example 均为 false），
 * 而生产实际由运维显式开启。诊断端点暴露各缓存域开关，避免"以为开了其实没开"
 * 的环境差异。绝不暴露密钥、DSN、token —— 只有布尔开关。
 */
export type CacheConfigSnapshot = {
  sellfoxResultCache: boolean;
  amazonResultCache: boolean;
  sellfoxAggregateRead: boolean;
  sellfoxListingProfileRead: boolean;
  /** 报告1 P1：销售预聚合的基准币种金额投影是否启用（未启用则 fxRate/amountBase 写 NULL）。 */
  sellfoxAggregateFxProjection: boolean;
  /** 报告1 P1：当前聚合对账 schema 版本；bump 会使旧 verdict 失效并强制重新对账。 */
  sellfoxAggSchemaVersion: string;
  allEnabled: boolean;
};

function on(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function readCacheConfig(env: Record<string, string | undefined> = process.env): CacheConfigSnapshot {
  const sellfoxResultCache = on(env.SELLFOX_CACHE_ENABLED);
  const amazonResultCache = on(env.AMAZON_CACHE_ENABLED);
  const sellfoxAggregateRead = on(env.SELLFOX_AGG_READ_ENABLED);
  const sellfoxListingProfileRead = on(env.SELLFOX_LISTING_PROFILE_READ_ENABLED);
  const sellfoxAggregateFxProjection = on(env.SELLFOX_AGG_FX_ENABLED);
  return {
    sellfoxResultCache,
    amazonResultCache,
    sellfoxAggregateRead,
    sellfoxListingProfileRead,
    sellfoxAggregateFxProjection,
    sellfoxAggSchemaVersion: (env.SELLFOX_AGG_SCHEMA_VERSION || "v1").trim() || "v1",
    allEnabled: sellfoxResultCache && amazonResultCache,
  };
}

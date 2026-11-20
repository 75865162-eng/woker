/**
 * 赛狐复刻页筛选参数编解码（M1）。
 *
 * 目标：多值筛选（站点/店铺/业务员）可组合、可回填、可分享，且与旧单值 URL 双向兼容。
 * 纯函数，无请求、无数据库、无副作用。
 *
 * 语法：
 *   - 多值统一用逗号分隔：`site=US,CA`、`shopExternalId=s1,s2`、`salesperson=张三,李四`。
 *   - 同时兼容重复键：`site=US&site=CA`（URLSearchParams.getAll）。
 *   - 旧单值 URL（`site=US`）读出来是长度为 1 的数组，行为不变。
 *   - 批量搜索：`search` 支持换行/逗号切分，返回 terms 数组（上限 200）。
 *
 * 铁律：
 *   - 筛选即围栏：本文件只做编码，真正的租户范围由服务端 where 保证，不信任前端值。
 *   - 不造数：解码不做默认填充，空值就是空数组/空串。
 */

export const SELLFOX_BATCH_SEARCH_LIMIT = 200;

export class SellfoxFilterCodecError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** 逗号分隔或重复键 → 去重后的非空字符串数组；保留原始顺序。 */
export function decodeMulti(values: (string | null)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const part of value.split(",")) {
      const item = part.trim();
      if (item && !seen.has(item)) { seen.add(item); out.push(item); }
    }
  }
  return out;
}

/** 从 URLSearchParams 读取多值参数（同时兼容 CSV 与重复键）。 */
export function decodeMultiParam(params: URLSearchParams, key: string): string[] {
  return decodeMulti(params.getAll(key));
}

/** 写回 URLSearchParams：多值用逗号合并成单个值；空数组不写入。 */
export function encodeMultiParam(params: URLSearchParams, key: string, values: string[]): void {
  const cleaned = decodeMulti(values);
  if (cleaned.length) params.set(key, cleaned.join(","));
}

/**
 * 批量搜索切分：换行或逗号分隔 → 去重后的数组。
 * 超过上限抛 413，明确告知未执行搜索（不静默截断，铁律：不造数/不放行空条件）。
 */
export function decodeBatchSearch(value: string | null | undefined, limit = SELLFOX_BATCH_SEARCH_LIMIT): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  const terms = decodeMulti(raw.split(/[\r\n,，]/));
  if (terms.length > limit) throw new SellfoxFilterCodecError(`批量搜索最多 ${limit} 个关键词，当前 ${terms.length} 个，请缩减后重试。`, 413);
  return terms;
}

/** 旧单值读取：多值数组取第一个，保持既有调用方（单值语义）不变。 */
export function firstOf(values: string[]): string {
  return values[0] ?? "";
}

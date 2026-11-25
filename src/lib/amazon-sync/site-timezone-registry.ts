/**
 * 站点业务时区注册表补充（报告1 P2）——补齐 marketplace-site.ts 有展示映射、
 * 但 date-range.ts 缺业务时区的站点（PL/BE/IE），并统一查询与覆盖度审计。
 *
 * 背景：本项目已有 18 站点时区映射（date-range.ts，DST 安全、未知站点 fail-closed），
 * 但 marketplace-site.ts 收录 21 站点。差集 PL/BE/IE 会因缺时区无法同步报表。
 * 本模块不修改既有 date-range.ts（避免改动同步主链路），提供：
 * - 补充时区常量（仅这 3 个差集站点）；
 * - 站点码/ID 统一时区查询（合并既有 + 补充，纯查表）；
 * - 覆盖度审计：显式列出仍缺时区的站点，供运维补齐，不静默忽略。
 *
 * 参考 IANA 标准时区（公开事实，非臆造业务值）：
 * PL=Europe/Warsaw, BE=Europe/Brussels, IE=Europe/Dublin。
 *
 * 红线：未知站点返回 null（不猜测、不用 Asia/Shanghai 一刀切）；纯函数、零 IO。
 */

import { sellfoxMarketplaceSites } from "@/lib/sellfox/marketplace-site";

/** 补充站点时区（date-range.ts 缺的 3 个站点）。 */
export const SUPPLEMENTAL_SITE_ZONES: Readonly<Record<string, string>> = Object.freeze({
  A1C3SOZRARQ6R3: "Europe/Warsaw",   // PL 波兰站
  AMEN7PMS3EDWL: "Europe/Brussels",  // BE 比利时站
  A28R8C7NBKEWEA: "Europe/Dublin",   // IE 爱尔兰站
});

/** 既有 date-range.ts 已核验的 18 站点时区（与 reportTimeZone 保持一致，此处仅用于覆盖度审计）。 */
const EXISTING_SITE_ZONES: Readonly<Record<string, string>> = Object.freeze({
  ATVPDKIKX0DER: "America/Los_Angeles", A2EUQ1WTGCTBG2: "America/Los_Angeles",
  A1AM78C64UM0Y8: "America/Los_Angeles", A2Q3Y263D00KWC: "America/Sao_Paulo",
  A1PA6795UKMFR9: "Europe/Berlin", A1RKKUPIHCS9HS: "Europe/Madrid", A13V1IB3VIYZZH: "Europe/Paris",
  A1F83G8C2ARO7P: "Europe/London", APJ6JRA9NG5V4: "Europe/Rome", A1VC38T7YXB528: "Asia/Tokyo",
  A1805IZSGTT6HS: "Europe/Amsterdam", A2NODRKZP88ZB9: "Europe/Stockholm",
  A33AVAJ2PDY3EV: "Europe/Istanbul", A17E79C6D8DWNP: "Asia/Riyadh", A2VIGQ35RCS4UG: "Asia/Dubai",
  A39IBJ37TRP1C6: "Australia/Sydney", A19VAU5U5O7RUS: "Asia/Singapore", A21TJRUUN4KGV: "Asia/Kolkata",
});

/** 全量站点时区（既有 18 + 补充 3 = 21）。 */
export const ALL_SITE_ZONES: Readonly<Record<string, string>> = Object.freeze({
  ...EXISTING_SITE_ZONES,
  ...SUPPLEMENTAL_SITE_ZONES,
});

/** 按 Marketplace ID 查时区；未知站点返回 null（fail-closed，不猜测）。 */
export function siteZoneOf(marketplaceId: unknown): string | null {
  const id = typeof marketplaceId === "string" ? marketplaceId.trim() : "";
  if (!id) return null;
  return ALL_SITE_ZONES[id] ?? null;
}

/** 站点码（US/DE/PL…）→ 时区：先按 ID 查，再按展示站点表反查 ID 后查。 */
export function siteCodeZoneOf(siteCode: unknown): string | null {
  const code = typeof siteCode === "string" ? siteCode.trim().toUpperCase() : "";
  if (!code) return null;
  const entry = Object.entries(sellfoxMarketplaceSites).find(([, v]) => v.code === code);
  if (!entry) return null;
  return ALL_SITE_ZONES[entry[0]] ?? null;
}

/** 覆盖度审计：列出展示站点中仍缺业务时区的 ID（应为 0，补齐后）。 */
export function siteTimezoneCoverage() {
  const ids = Object.keys(sellfoxMarketplaceSites);
  const covered = ids.filter(id => !!ALL_SITE_ZONES[id]);
  const missing = ids.filter(id => !ALL_SITE_ZONES[id]);
  return {
    totalSites: ids.length,
    coveredSites: covered.length,
    missingSites: missing,
    coverage: ids.length === 0 ? 0 : covered.length / ids.length,
    supplementalCount: Object.keys(SUPPLEMENTAL_SITE_ZONES).length,
  };
}

/** 校验 IANA 时区字符串在当前运行时有效（Intl 支持），无效返回 false。 */
export function isValidIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

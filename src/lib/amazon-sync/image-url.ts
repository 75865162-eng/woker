/**
 * 亚马逊图片 URL 纯函数（无 Node 依赖，服务端与客户端组件均可安全 import）。
 * 白名单严格限定亚马逊图片 CDN，不造 URL、不下载、不转码。
 */

export function amazonImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === "m.media-amazon.com" || /^images-(?:na|eu|fe)\.ssl-images-amazon\.com$/.test(url.hostname);
    return url.protocol === "https:" && allowedHost && !url.username && !url.password && !url.port ? url.toString() : null;
  } catch { return null; }
}

/** 商品图列表默认取 240px 缩略图：高清屏下 56~70px 容器仍清晰，远小于原图体积。 */
export const AMAZON_THUMBNAIL_EDGE = 240;

/**
 * 把亚马逊 CDN 原图 URL 改写成缩略图 URL——服务端只改路径上的尺寸后缀，不下载、不转码，
 * 由亚马逊 CDN 直接返回对应尺寸。非白名单 URL 返回 null（调用方保留原值）。
 *
 * 支持两种形态：
 *   /images/I/ABC.jpg                  → /images/I/ABC._SL240_.jpg
 *   /images/I/ABC._AC_SL1500_.jpg      → /images/I/ABC._SL240_.jpg
 * 尺寸 modifier 形如 ._XX_YY_（含下划线与逗号），改写幂等。
 */
export function amazonThumbnailUrl(value: unknown, edge: number = AMAZON_THUMBNAIL_EDGE): string | null {
  const safe = amazonImageUrl(value);
  if (!safe) return null;
  if (!Number.isInteger(edge) || edge < 16 || edge > 2000) return safe;
  try {
    const url = new URL(safe);
    const segments = url.pathname.split("/");
    const segment = segments[segments.length - 1] ?? "";
    const extMatch = /\.(jpe?g|png|webp)$/i.exec(segment);
    if (!extMatch) return safe;
    const ext = extMatch[0];
    const base = segment.slice(0, segment.length - ext.length);
    // 去掉末尾已有的尺寸 modifier（如 ._AC_SL1500_ / ._CR0,0,300,300_），再统一加目标尺寸
    const cleanBase = base.replace(/\._[A-Z0-9,_]+_$/, "");
    segments[segments.length - 1] = `${cleanBase}._SL${edge}_${ext}`;
    url.pathname = segments.join("/");
    return url.toString();
  } catch {
    return safe;
  }
}

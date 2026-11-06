/** Accept the filter names from the replica pages and the OpenAPI-shaped aliases. */
export function aliasSellfoxReplicaParams(url: URL) {
  const params = url.searchParams;
  for (const id of [...params.getAll("shopIds"), ...params.getAll("shopId")]) {
    const shopId = id.trim();
    if (shopId && !params.getAll("shopExternalId").includes(shopId)) params.append("shopExternalId", shopId);
  }
  if (!params.get("search")?.trim() && params.get("searchContent")?.trim()) params.set("search", params.get("searchContent")!.trim());
  if (!params.get("status")?.trim() && params.get("orderStatus")?.trim()) params.set("status", params.get("orderStatus")!.trim());
  const day = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  if (!params.get("from") && day(params.get("dateStart"))) params.set("from", day(params.get("dateStart")));
  if (!params.get("to") && day(params.get("dateEnd"))) params.set("to", day(params.get("dateEnd")));
  return url;
}

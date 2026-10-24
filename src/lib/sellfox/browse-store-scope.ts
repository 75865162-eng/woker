import { prisma } from "@/lib/db/prisma";
import { SellfoxBrowseError, type SellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

export async function sellfoxBrowseStoreIds(query: SellfoxBrowseQuery, organizationId: string, workspaceId: string) {
  const common = { organizationId, workspaceId };
  let ids: string[] | undefined;
  if (query.shopExternalIds.length) {
    const stores = await prisma.sellfoxStore.findMany({ where: { ...common, externalId: { in: query.shopExternalIds } }, select: { id: true } });
    if (stores.length !== query.shopExternalIds.length) throw new SellfoxBrowseError("店铺不属于当前工作区。", 403);
    ids = stores.map((store) => store.id);
  }
  if (query.storeId) {
    const store = await prisma.sellfoxStore.findFirst({ where: { ...common, id: query.storeId }, select: { id: true } });
    if (!store) throw new SellfoxBrowseError("店铺不属于当前工作区。", 403);
    ids = !ids || ids.includes(store.id) ? [store.id] : [];
  }
  return ids;
}

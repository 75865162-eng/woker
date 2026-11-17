import { prisma } from "@/lib/db/prisma";
import { SellfoxBrowseError, type SellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { resolveSellfoxVisibleStoreIds } from "./store-access";

type Actor = { id: string; role: string };
type Resolver = (actor: Actor, scope: { organizationId: string; workspaceId: string }) => Promise<string[] | undefined>;

/**
 * Resolve the store scope for any sellfox read.
 *
 * Side effect: when store scoping is active and the caller did not request a
 * specific store, the authorized external IDs are written back into `query`
 * so that every downstream reader (workbench SQL, agent SQL, listings, host)
 * inherits the same scope without per-reader changes.
 *
 * Returns internal store IDs for Prisma-based readers, or `undefined` to mean
 * "no store restriction" (legacy workspace-wide behavior).
 */
export async function sellfoxBrowseStoreIds(
  query: SellfoxBrowseQuery,
  organizationId: string,
  workspaceId: string,
  actor?: Actor,
  resolve: Resolver = resolveSellfoxVisibleStoreIds,
): Promise<string[] | undefined> {
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

  if (!actor) return ids;

  const visible = await resolve(actor, common);
  if (visible === undefined) return ids; // 未启用授权：保持旧行为

  if (ids) {
    const outside = ids.filter(id => !visible.includes(id));
    if (outside.length) throw new SellfoxBrowseError("请求的店铺超出数据授权范围。", 403);
    return ids; // 已收窄到授权子集
  }

  // 授权启用且未指定店铺：把授权店铺写回 query，供所有读取链路继承。
  if (visible.length === 0) {
    // 无授权店铺：强制空集。externalId 传一个不可能命中的哨兵值。
    query.shopExternalIds = ["__NO_SELLFOX_STORE__"];
    return [];
  }
  const authorizedStores = await prisma.sellfoxStore.findMany({ where: { ...common, id: { in: visible } }, select: { id: true, externalId: true } });
  query.shopExternalIds = authorizedStores.map(s => s.externalId);
  return authorizedStores.map(s => s.id);
}

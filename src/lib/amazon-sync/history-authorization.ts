import { Prisma } from "@prisma/client";

export type HistorySource = {
  id: string; revision: number; resource: string; authorizationId: string;
  sellerAccountId?: string; marketplaceId: string;
  authorization: { revision: number; amazonSellerId?: string | null; identityVerifiedAt?: Date | null };
};

function verifiedIdentity(source: HistorySource) {
  if (!source.authorization.identityVerifiedAt || !source.authorization.amazonSellerId || !source.sellerAccountId) return null;
  return { sourceId: source.id, sourceRevision: source.revision, resource: source.resource,
    authorizationId: source.authorizationId, amazonSellerId: source.authorization.amazonSellerId,
    sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId };
}

/** Historical evidence is not execution authority. Credential renewal alone
 * does not invalidate published history for an unchanged, verified identity.
 * Old/unknown identities remain restricted to the exact credential revision.
 * Callers still apply terminal/publication, source and tenant predicates.
 */
export function authorizationHistoryWhere(source: HistorySource): Prisma.AmazonSyncRunWhereInput {
  const identity = verifiedIdentity(source);
  const revision: Prisma.AmazonSyncRunWhereInput = { frozenScope: { path: ["authorizationRevision"], equals: source.authorization.revision } };
  return { AND: [
    { frozenScope: { path: ["authorizationId"], equals: source.authorizationId } },
    { frozenScope: { path: ["sourceRevision"], equals: source.revision } },
    ...(identity ? Object.entries(identity).map(([key, value]) => ({ frozenScope: { path: [key], equals: value } })) : []),
    identity ? { OR: [revision, { AND: [
      { frozenScope: { path: ["authorizationRevision"], gt: 0, lt: source.authorization.revision } },
    ] }] } : revision,
  ] };
}

/** Same identity rule for coverage's already-scoped in-memory history. */
export function matchesAuthorizationHistory(source: HistorySource, frozen: unknown) {
  if (!frozen || typeof frozen !== "object" || Array.isArray(frozen)) return false;
  const scope = frozen as Record<string, unknown>;
  if (scope.authorizationId !== source.authorizationId || scope.sourceRevision !== source.revision) return false;
  const identity = verifiedIdentity(source);
  if (identity && !Object.entries(identity).every(([key, value]) => scope[key] === value)) return false;
  if (scope.authorizationRevision === source.authorization.revision) return true;
  const revision = scope.authorizationRevision;
  return !!identity && typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0 && revision < source.authorization.revision;
}

/** Parameterized predicate for repository-side history aggregation. Uses the
 * same verified identity as ORM/in-memory coverage; never execution authority.
 * The calling query must bind tenant, source, resource and publication state.
 */
export function authorizationHistorySql(source: HistorySource): Prisma.Sql {
  const identity = verifiedIdentity(source);
  const base = identity ?? { authorizationId: source.authorizationId, sourceRevision: source.revision };
  const exact = Prisma.sql`"frozenScope" @> ${JSON.stringify({ ...base, authorizationRevision: source.authorization.revision })}::jsonb`;
  if (!identity) return exact;
  return Prisma.sql`("frozenScope" @> ${JSON.stringify(base)}::jsonb AND (
    ${exact} OR (
      CASE WHEN jsonb_typeof("frozenScope"->'authorizationRevision') = 'number'
        THEN ("frozenScope"->>'authorizationRevision')::numeric = trunc(("frozenScope"->>'authorizationRevision')::numeric)
        ELSE false END
      AND "frozenScope"->'authorizationRevision' > '0'::jsonb
      AND "frozenScope"->'authorizationRevision' < ${JSON.stringify(source.authorization.revision)}::jsonb
    )
  ))`;
}

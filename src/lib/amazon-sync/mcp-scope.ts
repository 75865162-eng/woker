import { SyncInputError } from "./policy";

/** Discovery lists authorized identities only. Every business/data operation
 * must explicitly select one pair, even for a credential with just one pair. */
export function requiresAmazonMcpScope(tool: string) {
  return tool !== "amazon.stores.list";
}

export function assertAmazonMcpScope(tool: string, args: Record<string, unknown>) {
  if (!requiresAmazonMcpScope(tool)) return;
  if (args.sellerAccountIds !== undefined) {
    throw new SyncInputError("数据范围不可访问：不允许跨账号查询；请指定单个 sellerAccountId 和 marketplaceId。", 403);
  }
  for (const key of ["sellerAccountId", "marketplaceId"] as const) {
    const value = args[key];
    if (typeof value !== "string" || !value.trim() || value.length > 200 || value !== value.trim()) {
      throw new SyncInputError("数据范围不可访问：必须显式指定单个 sellerAccountId 和 marketplaceId，不允许跨账号或跨站点查询。", 403);
    }
  }
}

/** Apply to every registered tool/alias so discovery and runtime agree. */
export function amazonMcpScopeSchema(tool: string, schema: Record<string, unknown>) {
  if (!requiresAmazonMcpScope(tool)) return schema;
  const properties = { ...(schema.properties as Record<string, unknown>) };
  delete properties.sellerAccountIds;
  return { ...schema, properties,
    required: [...new Set([...(Array.isArray(schema.required) ? schema.required as string[] : []), "sellerAccountId", "marketplaceId"])],
  };
}

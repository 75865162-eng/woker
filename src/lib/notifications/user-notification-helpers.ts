export type ProductWorkflowNotificationLinkData = {
  type: string;
  metadata?: unknown;
};

export function getProductWorkflowNotificationLink(item: ProductWorkflowNotificationLinkData) {
  if (!item.type.startsWith("product_workflow") || !item.metadata || typeof item.metadata !== "object") return null;
  const metadata = item.metadata as Record<string, unknown>;
  const sku = typeof metadata.sku === "string" ? metadata.sku.trim() : "";
  const workspaceId = typeof metadata.workspaceId === "string" ? metadata.workspaceId.trim() : "";
  if (!sku || !workspaceId) return null;
  return {
    sku,
    workspaceId,
    href: `/dashboard?sku=${encodeURIComponent(sku)}&workspaceId=${encodeURIComponent(workspaceId)}`,
  };
}

export function mergeWorkspaceScope(currentValue: string | null, workspaceId: string) {
  let current: { accountId?: string; marketplace?: string } = {};
  try {
    current = JSON.parse(currentValue ?? "{}") as typeof current;
  } catch {
    // Use empty optional scope values when local storage contains invalid JSON.
  }
  return {
    workspaceId,
    accountId: current.accountId ?? "",
    marketplace: current.marketplace ?? "",
  };
}

export function getCurrentPopupNotificationId(item: { id: string } | null | undefined) {
  return item?.id ?? null;
}

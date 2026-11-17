export function buildExecutionContext(
  user: { id: string; email: string; name: string; role: string; organizationId: string; organizationName: string },
  scope: { workspaceId: string; accountId: string; marketplace: string },
  rawContext: unknown,
  runtimeConfig: Record<string, unknown>,
) {
  const context = rawContext && typeof rawContext === "object" ? (rawContext as Record<string, unknown>) : {};

  return {
    ...context,
    runtimeConfig,
    company: {
      organizationId: user.organizationId,
      organizationName: user.organizationName,
    },
    workspace: {
      workspaceId: scope.workspaceId,
      accountId: scope.accountId,
      marketplace: scope.marketplace,
    },
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    sku: typeof context.sku === "string" ? context.sku : undefined,
    asin: typeof context.asin === "string" ? context.asin : undefined,
    marketplace: scope.marketplace,
    historicalData: context.historicalData ?? context.currentData,
    currentData: context.currentData ?? context.historicalData,
  };
}

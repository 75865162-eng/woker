export type WorkspaceScopeInput = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

export const defaultWorkspaceScope: WorkspaceScopeInput = {
  workspaceId: "default",
  accountId: "",
  marketplace: "",
};

function normalizeScopeValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type WorkspaceScopeLike = Partial<Record<keyof WorkspaceScopeInput, unknown>>;

export function normalizeWorkspaceScope(input?: WorkspaceScopeLike | null): WorkspaceScopeInput {
  const workspaceId = normalizeScopeValue(input?.workspaceId) || defaultWorkspaceScope.workspaceId;

  return {
    workspaceId,
    accountId: normalizeScopeValue(input?.accountId),
    marketplace: normalizeScopeValue(input?.marketplace).toUpperCase(),
  };
}

export function workspaceScopeFromUrl(url: string | URL): WorkspaceScopeInput {
  const searchParams = new URL(url).searchParams;

  return normalizeWorkspaceScope({
    workspaceId: searchParams.get("workspaceId"),
    accountId: searchParams.get("accountId"),
    marketplace: searchParams.get("marketplace"),
  });
}

export function workspaceScopeFromRequest(request: Request, body?: Record<string, unknown> | null): WorkspaceScopeInput {
  const urlScope = workspaceScopeFromUrl(request.url);

  return normalizeWorkspaceScope({
    workspaceId: body?.workspaceId ?? request.headers.get("x-workspace-id") ?? urlScope.workspaceId,
    accountId: body?.accountId ?? request.headers.get("x-account-id") ?? urlScope.accountId,
    marketplace: body?.marketplace ?? request.headers.get("x-marketplace") ?? urlScope.marketplace,
  });
}

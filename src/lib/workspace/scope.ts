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

/** 请求路径缺少 workspaceId 时抛出；服务端必须 fail-closed，客户端本地存储仍可回退 default。 */
export class WorkspaceScopeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

function normalizeScopeValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type WorkspaceScopeLike = Partial<Record<keyof WorkspaceScopeInput, unknown>>;
type NormalizeWorkspaceScopeOptions = {
  /** 服务端请求路径使用：缺失或非文本 workspaceId 时拒绝。 */
  requireWorkspaceId?: boolean;
};

export function normalizeWorkspaceScope(
  input?: WorkspaceScopeLike | null,
  options?: NormalizeWorkspaceScopeOptions,
): WorkspaceScopeInput {
  const requestedWorkspaceId = normalizeScopeValue(input?.workspaceId);
  if (!requestedWorkspaceId && options?.requireWorkspaceId) {
    throw new WorkspaceScopeError("缺少或无效 workspaceId：请求未携带有效工作区作用域，已拒绝。", 400);
  }
  const workspaceId = requestedWorkspaceId || defaultWorkspaceScope.workspaceId;

  return {
    workspaceId,
    accountId: normalizeScopeValue(input?.accountId),
    marketplace: normalizeScopeValue(input?.marketplace).toUpperCase(),
  };
}

export function isWorkspaceScopeComplete(scope: WorkspaceScopeInput) {
  return Boolean(scope.workspaceId.trim() && scope.accountId.trim() && scope.marketplace.trim());
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
  // 直接读原始查询参数，不取 workspaceScopeFromUrl 归一化后的 default，
  // 否则「未携带」会被误判为「已选择 default」，fail-closed 永远不触发。
  const urlWorkspaceId = new URL(request.url).searchParams.get("workspaceId");

  return normalizeWorkspaceScope({
    // 优先级保持 body > header > query；调用方 body 来自 request.json()。
    workspaceId: body?.workspaceId ?? request.headers.get("x-workspace-id") ?? urlWorkspaceId,
    accountId: body?.accountId ?? request.headers.get("x-account-id") ?? urlScope.accountId,
    marketplace: body?.marketplace ?? request.headers.get("x-marketplace") ?? urlScope.marketplace,
  }, { requireWorkspaceId: true });
}

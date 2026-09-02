export const workspaceScopeChangedEventName = "amazon-bulk-ad:workspace-scope-changed";

export type WorkspaceScopeChangedDetail = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
  source: "manual" | "auto";
};

export function emitWorkspaceScopeChanged(detail: WorkspaceScopeChangedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(workspaceScopeChangedEventName, { detail }));
}

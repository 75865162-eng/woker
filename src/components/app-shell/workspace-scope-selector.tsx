"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { emitWorkspaceScopeChanged } from "@/lib/workspace/workspace-scope-events";
import { fetchWorkspacesCached } from "@/lib/workspace/workspace-api-cache";
import { readWorkspaceScope, workspaceScopeStorageKey as storageKey } from "@/lib/workspace/workspace-scope-store";

type WorkspaceScope = {
  id: string;
  name: string;
  accountId?: string | null;
  marketplace?: string | null;
  isDefault?: boolean;
};

type SelectedScope = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

declare global {
  interface Window {
    __amazonBulkAdScopedFetchPatched?: boolean;
  }
}

function readSelectedScope(): SelectedScope {
  return readWorkspaceScope();
}

function writeSelectedScope(scope: SelectedScope) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(scope));
  } catch {
    // 不允许界面切到 B、请求却继续读取存储中的 A。
    return false;
  }
  document.cookie = `${storageKey}=${encodeURIComponent(JSON.stringify(scope))}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return true;
}

function isSameScope(left: SelectedScope, right: SelectedScope) {
  return left.workspaceId === right.workspaceId && left.accountId === right.accountId && left.marketplace === right.marketplace;
}

function shouldScopeFetch(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith("/api/")) return true;

  try {
    const parsed = new URL(url, window.location.origin);

    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function patchFetchWithWorkspaceScope() {
  if (typeof window === "undefined" || window.__amazonBulkAdScopedFetchPatched) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldScopeFetch(input)) {
      return originalFetch(input, init);
    }

    const scope = readSelectedScope();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    // 显式作用域是调用方在操作开始时的快照，不能在切换后被全局补丁改写。
    const explicitWorkspace = headers.get("x-workspace-id");
    if (!explicitWorkspace) headers.set("x-workspace-id", scope.workspaceId);
    if (!explicitWorkspace || explicitWorkspace === scope.workspaceId) {
      if (scope.accountId && !headers.has("x-account-id")) headers.set("x-account-id", scope.accountId);
      if (scope.marketplace && !headers.has("x-marketplace")) headers.set("x-marketplace", scope.marketplace);
    }

    return originalFetch(input, { ...init, headers });
  };
  window.__amazonBulkAdScopedFetchPatched = true;
}

function scopeLabel(scope: WorkspaceScope) {
  return [scope.name || scope.id, scope.marketplace, scope.accountId].filter(Boolean).join(" / ");
}

export function WorkspaceScopeSelector() {
  const [workspaces, setWorkspaces] = useState<WorkspaceScope[]>([]);
  const [selected, setSelected] = useState(() => readSelectedScope());
  const [storageError, setStorageError] = useState(false);
  const selectedRef = useRef(selected);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    patchFetchWithWorkspaceScope();
    writeSelectedScope(selectedRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supportsIdleCallback = typeof window.requestIdleCallback === "function";

    function applySelectedScope(nextSelected: SelectedScope, source: "manual" | "auto") {
      if (isSameScope(selectedRef.current, nextSelected)) {
        return;
      }

      if (!writeSelectedScope(nextSelected)) {
        setStorageError(true);
        return;
      }
      selectedRef.current = nextSelected;
      setStorageError(false);
      setSelected(nextSelected);
      emitWorkspaceScopeChanged({ ...nextSelected, source });
    }

    const loadWorkspaces = async () => {
      try {
        const data = await fetchWorkspacesCached();

        if (cancelled) return;

        const nextWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
        setWorkspaces(nextWorkspaces);
        const currentWorkspace = nextWorkspaces.find((workspace) => workspace.id === selectedRef.current.workspaceId);

        if (currentWorkspace) {
          applySelectedScope(
            {
              workspaceId: currentWorkspace.id,
              accountId: currentWorkspace.accountId ?? "",
              marketplace: currentWorkspace.marketplace ?? "",
            },
            "auto",
          );
          return;
        }

        const fallback = nextWorkspaces.find((workspace) => workspace.isDefault) ?? nextWorkspaces[0];

        if (fallback) {
          applySelectedScope(
            {
              workspaceId: fallback.id,
              accountId: fallback.accountId ?? "",
              marketplace: fallback.marketplace ?? "",
            },
            "auto",
          );
        }
      } catch {
        if (!cancelled) setWorkspaces([]);
      }
    };

    const idleCallbackId: number = supportsIdleCallback
      ? window.requestIdleCallback(() => void loadWorkspaces(), { timeout: 1500 })
      : window.setTimeout(() => void loadWorkspaces(), 900);

    return () => {
      cancelled = true;
      if (supportsIdleCallback) {
        window.cancelIdleCallback(idleCallbackId);
      } else {
        window.clearTimeout(idleCallbackId);
      }
    };
  }, []);

  const selectedValue = useMemo(() => selected.workspaceId || "default", [selected.workspaceId]);

  function handleChange(value: string) {
    const workspace = workspaces.find((item) => item.id === value);
    const nextSelected = {
      workspaceId: value || "default",
      accountId: workspace?.accountId ?? "",
      marketplace: workspace?.marketplace ?? "",
    };

    if (isSameScope(selectedRef.current, nextSelected)) {
      return;
    }

    if (!writeSelectedScope(nextSelected)) {
      setStorageError(true);
      return;
    }
    selectedRef.current = nextSelected;
    setStorageError(false);
    setSelected(nextSelected);
    emitWorkspaceScopeChanged({ ...nextSelected, source: "manual" });
  }

  if (!workspaces.length) return null;

  return (
    <label className="hidden items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold text-muted shadow-sm xl:flex">
      <BriefcaseBusiness className="h-4 w-4 text-brand" />
      <select
        value={selectedValue}
        onChange={(event) => handleChange(event.target.value)}
        className="max-w-[220px] bg-transparent text-xs font-semibold text-foreground outline-none"
        title="选择工作区"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {scopeLabel(workspace)}
          </option>
        ))}
      </select>
      {storageError && <span role="alert" className="text-danger">无法保存工作区，未切换。请检查浏览器存储权限。</span>}
    </label>
  );
}

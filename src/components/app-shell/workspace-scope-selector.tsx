"use client";

import { useEffect, useRef, useState } from "react";
import { Globe2 } from "lucide-react";
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

export function WorkspaceScopeSelector() {
  const [workspaces, setWorkspaces] = useState<WorkspaceScope[]>([]);
  const [selected, setSelected] = useState(() => readSelectedScope());
  const [storageError, setStorageError] = useState(false);
  const [ready, setReady] = useState(false);
  const selectedRef = useRef(selected);
  const applyRef = useRef<(next: SelectedScope, source: "manual" | "auto") => void>(() => {});

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
        setReady(true);
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
        if (!cancelled) {
          setWorkspaces([]);
          setReady(true);
        }
      }
    };
    applyRef.current = applySelectedScope;

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

  // 全局工作区/店铺上下文切换器：切换走 applySelectedScope，
  // 它会写存储、广播 scope-changed 事件，AppShell 据此强制重挂载内容，防止旧账号数据闪现。
  // 副作用链（fetch 头注入、默认工作区选中）保持不变。
  const options = workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    accountId: workspace.accountId ?? "",
    marketplace: workspace.marketplace ?? "",
    label: workspace.marketplace ? `${workspace.name} · ${workspace.marketplace}` : workspace.name,
  }));
  const currentKey = `${selected.workspaceId}|${selected.accountId}|${selected.marketplace}`;

  return (
    <label className="flex min-w-0 items-center gap-1.5" title="全局工作区 / 店铺上下文，切换后全站生效">
      <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      <select
        aria-label="全局工作区切换"
        value={ready ? currentKey : ""}
        disabled={!ready || options.length === 0}
        onChange={(event) => {
          const target = options.find((option) => `${option.workspaceId}|${option.accountId}|${option.marketplace}` === event.target.value);
          if (target) applyRef.current(target, "manual");
        }}
        className={`max-w-[220px] truncate rounded-md border bg-surface px-2 py-1 text-label text-foreground outline-none transition-colors hover:border-brand disabled:opacity-50 ${storageError ? "border-danger" : "border-border"}`}
      >
        {!ready || options.length === 0 ? <option value="">加载工作区…</option> : null}
        {options.map((option) => {
          const key = `${option.workspaceId}|${option.accountId}|${option.marketplace}`;
          return <option key={key} value={key}>{option.label}</option>;
        })}
      </select>
      {storageError ? <span className="text-label text-danger-ink" role="alert">切换失败</span> : null}
    </label>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { emitWorkspaceScopeChanged } from "@/lib/workspace/workspace-scope-events";

const storageKey = "amazon_bulk_ad_workspace_scope";

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
  if (typeof window === "undefined") {
    return { workspaceId: "default", accountId: "", marketplace: "" };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Partial<SelectedScope>;

    return {
      workspaceId: parsed.workspaceId || "default",
      accountId: parsed.accountId || "",
      marketplace: parsed.marketplace || "",
    };
  } catch {
    return { workspaceId: "default", accountId: "", marketplace: "" };
  }
}

function writeSelectedScope(scope: SelectedScope) {
  window.localStorage.setItem(storageKey, JSON.stringify(scope));
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

    headers.set("x-workspace-id", scope.workspaceId);
    if (scope.accountId) headers.set("x-account-id", scope.accountId);
    if (scope.marketplace) headers.set("x-marketplace", scope.marketplace);

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
  const selectedRef = useRef(selected);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    patchFetchWithWorkspaceScope();
  }, []);

  useEffect(() => {
    let cancelled = false;

    function applySelectedScope(nextSelected: SelectedScope, source: "manual" | "auto") {
      if (isSameScope(selectedRef.current, nextSelected)) {
        return;
      }

      setSelected(nextSelected);
      writeSelectedScope(nextSelected);
      emitWorkspaceScopeChanged({ ...nextSelected, source });
    }

    fetch("/api/workspaces")
      .then((response) => (response.ok ? response.json() : { workspaces: [] }))
      .then((data: { workspaces?: WorkspaceScope[] }) => {
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
        } else {
          const fallback = nextWorkspaces.find((workspace) => workspace.isDefault) ?? nextWorkspaces[0];

          if (fallback) {
            const nextSelected = {
              workspaceId: fallback.id,
              accountId: fallback.accountId ?? "",
              marketplace: fallback.marketplace ?? "",
            };
            applySelectedScope(nextSelected, "auto");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selected.workspaceId]);

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

    setSelected(nextSelected);
    writeSelectedScope(nextSelected);
    emitWorkspaceScopeChanged({ ...nextSelected, source: "manual" });
  }

  if (!workspaces.length) return null;

  return (
    <label className="hidden items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-muted shadow-sm xl:flex">
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
    </label>
  );
}

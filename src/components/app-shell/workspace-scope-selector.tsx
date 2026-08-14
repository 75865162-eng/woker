"use client";

import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { readSelectedWorkspaceScope, writeSelectedWorkspaceScope } from "@/lib/workspace/scoped-fetch";

type WorkspaceScope = {
  id: string;
  name: string;
  accountId?: string | null;
  marketplace?: string | null;
  isDefault?: boolean;
};

function scopeLabel(scope: WorkspaceScope) {
  return [scope.name || scope.id, scope.marketplace, scope.accountId].filter(Boolean).join(" / ");
}

export function WorkspaceScopeSelector() {
  const [workspaces, setWorkspaces] = useState<WorkspaceScope[]>([]);
  const [selected, setSelected] = useState(() => readSelectedWorkspaceScope());

  useEffect(() => {
    let cancelled = false;

    fetch("/api/workspaces")
      .then((response) => (response.ok ? response.json() : { workspaces: [] }))
      .then((data: { workspaces?: WorkspaceScope[] }) => {
        if (cancelled) return;

        const nextWorkspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
        setWorkspaces(nextWorkspaces);
        if (!nextWorkspaces.some((workspace) => workspace.id === selected.workspaceId)) {
          const fallback = nextWorkspaces.find((workspace) => workspace.isDefault) ?? nextWorkspaces[0];

          if (fallback) {
            const nextSelected = {
              workspaceId: fallback.id,
              accountId: fallback.accountId ?? "",
              marketplace: fallback.marketplace ?? "",
            };
            setSelected(nextSelected);
            writeSelectedWorkspaceScope(nextSelected);
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

    setSelected(nextSelected);
    writeSelectedWorkspaceScope(nextSelected);
    window.location.reload();
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

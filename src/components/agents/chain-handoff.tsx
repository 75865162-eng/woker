"use client";

import { useEffect, useRef, useState } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import {
  createHandoff, handoffKinds, handoffStorageKeys, readHandoffTrace, validateHandoff,
  type ChainStage, type HandoffIdentity, type HandoffKind, type HandoffPayload,
} from "@/lib/agent-platform/handoff";

export function chainWorkspaceScope() {
  try { return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")); }
  catch { return normalizeWorkspaceScope(); }
}

export function chainHeaders(json = false) {
  const scope = chainWorkspaceScope();
  return { ...(json ? { "Content-Type": "application/json" } : {}), "x-workspace-id": scope.workspaceId, "x-account-id": scope.accountId, "x-marketplace": scope.marketplace };
}

export async function chainFetch(input: string, init?: RequestInit) {
  const workspaceId = chainWorkspaceScope().workspaceId;
  const response = await fetch(input, init);
  if (workspaceId !== chainWorkspaceScope().workspaceId) throw new Error("工作区已变化，已丢弃上一工作区的响应。");
  const readJson = response.json.bind(response);
  response.json = async () => {
    const value = await readJson();
    if (workspaceId !== chainWorkspaceScope().workspaceId) throw new Error("工作区已变化，已丢弃上一工作区的响应。");
    return value;
  };
  return response;
}

/** Keep refreshes and shared trace links on the execution just created. */
export function rememberChainExecution(executionId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("executionId", executionId);
  window.history.replaceState(null, "", url);
}

export function sendChainHandoff(options: {
  from: ChainStage | "orchestrator"; to: ChainStage; payload: Record<string, unknown>;
  sourceExecutionId: string; sourceWorkspaceId?: string; organizationId?: string; userId?: string; planId?: string; kind?: HandoffKind;
  previous?: HandoffPayload | null;
}) {
  const identity: HandoffIdentity = {
    organizationId: options.organizationId ?? "", userId: options.userId ?? "", workspaceId: chainWorkspaceScope().workspaceId,
  };
  if (options.sourceWorkspaceId !== identity.workspaceId) throw new Error("来源执行不属于当前工作区，请刷新后重新交接。");
  const traceLinks = [...readHandoffTrace(options.previous ?? options.payload).filter((ref) => ref.executionId !== options.sourceExecutionId), { stage: options.from, executionId: options.sourceExecutionId }].slice(-12);
  const value = createHandoff({ ...options.payload, traceLinks }, {
    ...identity, from: options.from, to: options.to, kind: options.kind ?? handoffKinds[options.to],
    sourceExecutionId: options.sourceExecutionId, planId: options.planId ?? options.previous?._handoff?.planId,
  });
  // A failed write must leave the user on the source page.
  sessionStorage.setItem(handoffStorageKeys[options.to], JSON.stringify(value));
  window.location.href = options.to === "launch" ? "/agents/orchestrator" : `/agents/${options.to}`;
}

export function useChainHandoff(to: ChainStage) {
  const user = useAppShellUser();
  const [payload, setPayload] = useState<HandoffPayload | null>(null);
  const [error, setError] = useState("");
  const identityKey = useRef("");
  const hadHandoff = useRef(false);
  useEffect(() => {
    if (!user?.organizationId || !user.userId) return;
    const currentIdentity = `${user.organizationId}/${user.userId}`;
    if (identityKey.current && identityKey.current !== currentIdentity) { setPayload(null); setError("身份已变化，请重新交接。"); }
    identityKey.current = currentIdentity;
    const key = handoffStorageKeys[to];
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        hadHandoff.current = true;
        setPayload(validateHandoff(JSON.parse(raw), to, { organizationId: user.organizationId, userId: user.userId, workspaceId: chainWorkspaceScope().workspaceId }));
        sessionStorage.removeItem(key);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "读取交接失败。"); }
    const changed = () => { setPayload(null); if (hadHandoff.current) setError("工作区已变化，请重新加载对应工作区的交接。"); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, [to, user?.organizationId, user?.userId]);
  return { payload, error };
}

export function ChainHandoffNotice({ payload, error }: { payload: HandoffPayload | null; error: string }) {
  if (error) return <p role="alert" className="rounded border border-danger/30 p-2 text-sm text-danger">{error}</p>;
  if (!payload) return null;
  const meta = payload._handoff;
  const agent = meta?.from === "orchestrator" || meta?.from === "launch" ? "orchestrator" : meta?.from;
  return <div className="rounded border border-border p-2 text-sm" role="status">
    已加载交接，运行前请复核。{meta ? <a className="ml-2 text-brand underline" href={`/agents/${agent}?executionId=${encodeURIComponent(meta.sourceExecutionId)}`}>查看来源执行</a> : "旧版交接无执行来源。"}
  </div>;
}

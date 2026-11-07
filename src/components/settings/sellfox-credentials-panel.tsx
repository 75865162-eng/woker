"use client";

import { useEffect, useRef, useState } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { Button } from "@/components/ui/button";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { SellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import { SellfoxCredentialsForm, type SellfoxCredentialSubmission } from "./sellfox-credentials-form";

type Status = SellfoxCredentialStatus & { canEdit: boolean; scope: { organizationId: string; workspaceId: string } };
export function SellfoxCredentialsPanel() {
  const user = useAppShellUser();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const saveController = useRef<AbortController | null>(null);
  const testController = useRef<AbortController | null>(null);
  useEffect(() => {
    let controller: AbortController;
    let disposed = false;
    async function load() {
      controller?.abort(); saveController.current?.abort(); testController.current?.abort(); testController.current = null;
      controller = new AbortController();
      const generation = ++epoch.current;
      setStatus(null); setError(""); setSaving(false); setTesting(false); setTestResult(null);
      let stored: unknown;
      try { stored = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}"); } catch { stored = {}; }
      const scope = normalizeWorkspaceScope(stored as Parameters<typeof normalizeWorkspaceScope>[0]);
      try {
        const response = await fetch("/api/integrations/sellfox/credentials", { headers: { "x-workspace-id": scope.workspaceId }, cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (disposed || generation !== epoch.current) return;
        if (!response.ok) throw new Error(result.error || "赛狐配置读取失败。");
        if (result.scope?.workspaceId !== scope.workspaceId || (user?.organizationId && result.scope?.organizationId !== user.organizationId)) throw new Error("配置范围已变化，请重新读取。");
        setStatus(result);
      } catch (error) {
        if (!disposed && generation === epoch.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : "赛狐配置读取失败。");
      }
    }
    const changed = () => { void load(); };
    void load();
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { disposed = true; controller?.abort(); saveController.current?.abort(); testController.current?.abort(); window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, [refresh, user?.organizationId, user?.userId]);

  async function save(credentials: SellfoxCredentialSubmission) {
    if (!status) throw new Error("not ready");
    const generation = epoch.current;
    const controller = new AbortController(); saveController.current = controller;
    testController.current?.abort(); setTesting(false); setTestResult(null);
    setError(""); setSaving(true);
    try {
      const response = await fetch("/api/integrations/sellfox/credentials", { method: "PUT", headers: { "Content-Type": "application/json", "x-workspace-id": status.scope.workspaceId }, cache: "no-store", signal: controller.signal, body: JSON.stringify({ ...credentials, revision: status.revision }) });
      const result = await response.json();
      if (controller.signal.aborted || generation !== epoch.current) throw new Error("scope changed");
      if (!response.ok) { setError(result.error || "赛狐配置保存失败。"); throw new Error("save failed"); }
      setStatus({ ...status, configured: true, source: "database", revision: result.revision, updatedAt: new Date().toISOString() });
    } finally { if (!controller.signal.aborted && generation === epoch.current) setSaving(false); }
  }
  async function testConnection() {
    if (!status?.canEdit || !status.configured || saving || testController.current) return;
    const generation = epoch.current;
    const controller = new AbortController(); testController.current = controller;
    setTesting(true); setTestResult(null); setError("");
    try {
      const response = await fetch("/api/integrations/sellfox/credentials/test", { method: "POST", headers: { "x-workspace-id": status.scope.workspaceId, "x-credential-revision": String(status.revision) }, cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted || generation !== epoch.current) return;
      if (!response.ok) { setError(result.error || "连接测试未完成，请重试。"); return; }
      setTestResult({ passed: result.passed === true, message: result.message });
    } catch {
      if (!controller.signal.aborted && generation === epoch.current) setError("连接测试未完成，请检查网络后重试。");
    } finally {
      if (testController.current === controller) testController.current = null;
      if (!controller.signal.aborted && generation === epoch.current) setTesting(false);
    }
  }
  return <section id="sellfox-credentials" className="scroll-mt-4 space-y-3 rounded-lg border border-border bg-white p-5">
    {status ? <>
      <fieldset disabled={testing} className="min-w-0">
        <SellfoxCredentialsForm key={`${status.scope.organizationId}:${status.scope.workspaceId}`} configured={status.configured} canEdit={status.canEdit} encryptionReady={status.encryptionReady && status.storageReady} scopeLabel={`${status.scope.organizationId} / ${status.scope.workspaceId}`} onSave={save} />
      </fieldset>
      <div className="space-y-2">
        <Button type="button" variant="secondary" size="sm" disabled={!status.canEdit || !status.configured || saving || testing} onClick={() => void testConnection()}>{testing ? "正在测试连接…" : "测试连接"}</Button>
        <p className="text-xs text-muted">测试已保存的凭据；修改输入框后请先保存。点击后仅请求赛狐 Token，不读取业务数据或启动同步，每分钟限一次。</p>
        {testResult && <p role={testResult.passed ? "status" : "alert"} className={testResult.passed ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{testResult.message}</p>}
      </div>
      <p className="text-xs text-muted">来源：{status.source === "database" ? "工作区加密配置" : status.source === "environment" ? "现有服务端环境变量" : "尚未配置"} · 版本 {status.revision}{status.updatedAt ? ` · 更新时间 ${new Date(status.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</p>
      {status.configurationError && <p role="alert" className="text-xs text-red-700">{status.configurationError}</p>}
      {!status.storageReady && <p role="alert" className="text-xs text-amber-800">凭据表尚未就绪，请管理员按审批流程应用当前版本迁移。页面不会自动执行迁移。</p>}
      {!status.encryptionReady && <p className="text-xs text-amber-800">服务端需配置 SELLFOX_CREDENTIAL_ENCRYPTION_KEY（32 字节 Base64）；不要替换已有主密钥。主密钥不在此表单输入。</p>}
      <p className="text-xs text-muted">新凭据用于后续任务，正在运行的任务继续使用启动时版本，不会因保存而自动重启。</p>
    </> : <><h2 className="text-sm font-semibold">赛狐 Open API 凭据</h2>{!error && <p className="text-xs text-muted">正在读取当前工作区配置…</p>}</>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <Button variant="secondary" size="sm" type="button" disabled={saving} onClick={() => setRefresh(value => value + 1)}>重新读取配置</Button>
  </section>;
}

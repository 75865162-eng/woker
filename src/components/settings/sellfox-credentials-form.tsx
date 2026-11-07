"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export type SellfoxCredentialSubmission = { clientId: string; clientSecret: string };

/** Presentational form; the caller owns scoped authorization and persistence. */
export function SellfoxCredentialsForm({
  configured,
  canEdit,
  encryptionReady,
  scopeLabel,
  onSave,
}: {
  configured: boolean;
  canEdit: boolean;
  encryptionReady: boolean;
  scopeLabel: string;
  onSave: (credentials: SellfoxCredentialSubmission) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const disabled = !canEdit || !encryptionReady || busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const clientId = String(fields.get("clientId") ?? "").trim();
    const clientSecret = String(fields.get("clientSecret") ?? "").trim();
    if (!clientId && !clientSecret) {
      setFailed(true);
      setMessage("请填写需要保存的凭据。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await onSave({ clientId, clientSecret });
      form.reset();
      setMessage("赛狐凭据已保存。保存不会测试连接或自动启动同步。");
    } catch {
      // Never render transport errors, which could contain submitted secrets.
      setFailed(true);
      setMessage("保存未成功，请检查配置状态与权限后重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form aria-label="赛狐凭据配置" aria-busy={busy} onSubmit={submit} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">赛狐 Open API 凭据</h2>
      <span className="text-xs text-muted">{configured ? "已配置" : "未配置"}</span>
    </div>
    <p className="text-xs text-muted">保存范围：{scopeLabel}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {([ ["clientId", "Client ID"], ["clientSecret", "Client Secret"] ] as const).map(([name, label]) => <label key={name} className="grid gap-1 text-xs font-medium">
        {label}{configured ? "（留空保留）" : "（必填）"}
        <input className="h-9 w-full rounded border border-border bg-white px-3 text-sm font-normal" name={name} type="password" autoComplete="new-password" spellCheck={false} required={!configured} maxLength={16384} disabled={disabled} placeholder={configured ? "不回显已有值，留空保留" : `请输入 ${label}`} />
      </label>)}
    </div>
    <p className="text-xs text-muted">凭据只提交到服务端加密保存，不写入浏览器恢复缓存，不回显已有值。保存不会请求赛狐或开启同步计划。</p>
    {!canEdit && <p className="text-xs text-amber-800">仅当前组织有配置权限的管理员可以保存凭据。</p>}
    {!encryptionReady && <p role="alert" className="text-xs text-amber-800">服务端加密存储尚未就绪，请管理员先完成加密主密钥配置。</p>}
    {message && <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{message}</p>}
    <Button type="submit" size="sm" disabled={disabled}>{busy ? "正在保存…" : "保存赛狐凭据"}</Button>
  </form>;
}

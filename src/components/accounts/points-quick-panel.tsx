"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Coins, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PointsLedgerDrawer } from "@/components/points/points-ledger-drawer";

export type PointsRow = {
  userId: string;
  balance: number;
  reserved: number;
  baseQuota: number;
  carriedIn: number;
  extraGranted: number;
  consumed: number;
  totalQuota: number;
  pendingRequests: number;
  status: string;
};

type OverrideRow = {
  monthlyQuota: number | null;
  carryoverCap: number | null;
  canApprove: boolean;
  canRequest: boolean;
  note: string | null;
};

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand";

export function PointsQuickPanel({
  userId,
  userName,
  row,
  canAdjust,
  onChanged,
}: {
  userId: string;
  userName: string;
  row: PointsRow | null;
  canAdjust: boolean;
  onChanged?: () => void;
}) {
  const [loadingOverride, setLoadingOverride] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState({ monthlyQuota: "", carryoverCap: "", canApprove: false, canRequest: true });
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustDraft, setAdjustDraft] = useState({ amount: "", reason: "" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverride = useCallback(async () => {
    if (!canAdjust) return;

    setLoadingOverride(true);
    setError(null);

    try {
      const response = await fetch(`/api/points/override?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      if (!response.ok) return;

      const body = (await response.json()) as { overrides: Array<OverrideRow & { userId: string }> };
      const found = body.overrides.find((item) => item.userId === userId) ?? null;

      const hasCustom = Boolean(found && (found.monthlyQuota !== null || found.carryoverCap !== null));
      setCustomMode(hasCustom);
      setDraft({
        monthlyQuota: found?.monthlyQuota !== null && found?.monthlyQuota !== undefined ? String(found.monthlyQuota) : "",
        carryoverCap: found?.carryoverCap !== null && found?.carryoverCap !== undefined ? String(found.carryoverCap) : "",
        canApprove: found?.canApprove ?? false,
        canRequest: found?.canRequest ?? true,
      });
    } catch {
      // 读取覆盖失败不阻塞主面板，保持组织默认展示
    } finally {
      setLoadingOverride(false);
    }
  }, [canAdjust, userId]);

  useEffect(() => {
    void loadOverride();
  }, [loadOverride]);

  async function saveOverride() {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/points/override", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          monthlyQuota: customMode && draft.monthlyQuota ? Number(draft.monthlyQuota) : null,
          carryoverCap: customMode && draft.carryoverCap ? Number(draft.carryoverCap) : null,
          canApprove: draft.canApprove,
          canRequest: draft.canRequest,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(body.error ?? "保存失败。");

      setNotice("已保存，从下个周期起生效。");
      await loadOverride();
      onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function submitAdjust() {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/points/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, amount: Number(adjustDraft.amount), reason: adjustDraft.reason }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(body.error ?? "调额失败。");

      setNotice(`调额成功，当前余额 ${body.balanceAfter} 分。`);
      setAdjustOpen(false);
      setAdjustDraft({ amount: "", reason: "" });
      onChanged?.();
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : "调额失败。");
    } finally {
      setSaving(false);
    }
  }

  const totalQuota = row?.totalQuota ?? 0;
  const balance = row?.balance ?? 0;
  const usedPercent = totalQuota > 0 ? Math.min(100, Math.round(((row?.consumed ?? 0) / totalQuota) * 100)) : 0;
  const lowBalance = totalQuota > 0 && balance / totalQuota <= 0.2;

  return (
    <div className="rounded-md border border-border bg-surface-muted px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-brand" />
          <p className="text-sm font-bold text-foreground">积分额度</p>
          {row?.pendingRequests ? <Badge tone="blue">待审批 {row.pendingRequests}</Badge> : null}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`text-lg font-black ${balance === 0 ? "text-red-600" : "text-foreground"}`}>{balance}</span>
          <span className="text-xs text-muted">/ {totalQuota} 可用</span>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className={`h-full ${usedPercent >= 80 ? "bg-red-500" : usedPercent >= 60 ? "bg-amber-500" : "bg-brand"}`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>基础 {row?.baseQuota ?? 0}</span>
        <span>结转 {row?.carriedIn ?? 0}</span>
        <span>补充 {row?.extraGranted ?? 0}</span>
        <span>已用 {row?.consumed ?? 0}</span>
        {row?.reserved ? <span className="text-amber-600">冻结 {row.reserved}</span> : null}
      </div>

      {lowBalance && balance > 0 ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          剩余额度已低于 20%，建议追加。
        </p>
      ) : null}

      {balance === 0 && totalQuota > 0 ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          本周期额度已用完，该成员需要提交申请。
        </p>
      ) : null}

      {canAdjust ? (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={customMode} onChange={(event) => setCustomMode(event.target.checked)} />
            单独设置该账号额度
          </label>

          {customMode ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-bold text-muted">月额度</span>
                <input
                  className={fieldClass}
                  type="number"
                  min={0}
                  placeholder="留空继承组织默认"
                  value={draft.monthlyQuota}
                  onChange={(event) => setDraft({ ...draft, monthlyQuota: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-muted">结转上限</span>
                <input
                  className={fieldClass}
                  type="number"
                  min={0}
                  placeholder="留空继承组织默认"
                  value={draft.carryoverCap}
                  onChange={(event) => setDraft({ ...draft, carryoverCap: event.target.value })}
                />
              </label>
            </div>
          ) : (
            <p className="text-xs text-muted">当前使用组织默认额度，保存后从下个周期生效。</p>
          )}

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={draft.canApprove}
                onChange={(event) => setDraft({ ...draft, canApprove: event.target.checked })}
              />
              可审批他人申请
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={draft.canRequest}
                onChange={(event) => setDraft({ ...draft, canRequest: event.target.checked })}
              />
              可提交申请
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={saving || loadingOverride} onClick={() => void saveOverride()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存设置
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdjustOpen((open) => !open)}>
              <SlidersHorizontal className="h-4 w-4" />
              调整额度
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDrawerOpen(true)}>
              <RefreshCw className="h-4 w-4" />
              查看流水
            </Button>
          </div>

          {adjustOpen ? (
            <div className="space-y-2 rounded-md border border-border bg-white px-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted">数量（负数为扣减）</span>
                  <input
                    className={fieldClass}
                    type="number"
                    placeholder="例如 50 或 -20"
                    value={adjustDraft.amount}
                    onChange={(event) => setAdjustDraft({ ...adjustDraft, amount: event.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted">原因（至少 10 字）</span>
                  <input
                    className={fieldClass}
                    placeholder="写清依据，会进审计"
                    value={adjustDraft.reason}
                    onChange={(event) => setAdjustDraft({ ...adjustDraft, reason: event.target.value })}
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAdjustOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={saving || !adjustDraft.amount || adjustDraft.reason.trim().length < 10}
                  onClick={() => void submitAdjust()}
                >
                  确认调整
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {notice ? <p className="mt-2 text-xs text-green-700">{notice}</p> : null}

      {drawerOpen ? <PointsLedgerDrawer userId={userId} userName={userName} onClose={() => setDrawerOpen(false)} /> : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Coins, Loader2, RefreshCw, Save, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Access = {
  canViewSelf: boolean;
  canViewOrg: boolean;
  canAdjust: boolean;
  canApprove: boolean;
  canConfigure: boolean;
};

type OrgRow = {
  userId: string;
  name: string;
  department: string;
  title: string;
  roleId: string;
  status: string;
  balance: number;
  reserved: number;
  baseQuota: number;
  carriedIn: number;
  extraGranted: number;
  consumed: number;
  totalQuota: number;
  pendingRequests: number;
};

type OverviewPayload = {
  period: string;
  rows: OrgRow[];
  totals: { consumed: number; balance: number; pending: number };
  access: Access;
};

type Policy = {
  baseQuota: number;
  carryoverCap: number;
  maxRequestsPerPeriod: number;
  maxRequestAmount: number;
  maxExtraPerPeriod: number;
  requestExpireDays: number;
  reserveTimeoutMinutes: number;
  warnPercent: number;
  grantOnCreate: boolean;
  grantToDisabled: boolean;
  timezone: string;
};

type PriceRule = {
  id: string;
  operationCode: string;
  label: string;
  version: number;
  unitCost: number;
  maxCost: number;
  dailyFreeCount: number;
  status: string;
};

type RequestItem = {
  id: string;
  requestNo: string;
  applicantId: string;
  applicantName: string | null;
  period: string;
  requestedAmount: number;
  approvedAmount: number | null;
  reason: string;
  status: string;
  approverName: string | null;
  createdAt: string;
};

type PendingAction = { id: string; action: "approve" | "reject" } | null;

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand";

function statusBadge(row: OrgRow) {
  if (row.status === "disabled" || row.status === "archived") return <Badge tone="gray">已冻结</Badge>;
  if (row.totalQuota > 0 && row.balance === 0) return <Badge tone="red">已耗尽</Badge>;
  if (row.totalQuota > 0 && row.balance / row.totalQuota <= 0.2) return <Badge tone="amber">即将耗尽</Badge>;

  return <Badge tone="green">正常</Badge>;
}

function usagePercent(row: OrgRow) {
  if (row.totalQuota <= 0) return 0;

  return Math.min(100, Math.round((row.consumed / row.totalQuota) * 100));
}

export function PointsPolicyPanel() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [overviewRes, policyRes, priceRes, requestRes] = await Promise.all([
        fetch("/api/points/overview", { cache: "no-store" }),
        fetch("/api/points/policy", { cache: "no-store" }),
        fetch("/api/points/price", { cache: "no-store" }),
        fetch("/api/points/requests?scope=org&status=PENDING&take=20", { cache: "no-store" }),
      ]);

      if (!overviewRes.ok) throw new Error((await overviewRes.json().catch(() => ({}))).error ?? "加载额度总览失败。");

      const overviewBody = (await overviewRes.json()) as OverviewPayload;
      setOverview(overviewBody);

      if (policyRes.ok) {
        const policyBody = (await policyRes.json()) as { policy: Policy };
        setPolicy(policyBody.policy);
        setDraft(policyBody.policy);
      }

      if (priceRes.ok) {
        const priceBody = (await priceRes.json()) as { rules: PriceRule[] };
        setRules(priceBody.rules);
      }

      if (requestRes.ok) {
        const requestBody = (await requestRes.json()) as { items: RequestItem[] };
        setRequests(requestBody.items);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const list = overview?.rows ?? [];
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? list.filter((row) => [row.name, row.department, row.title].some((value) => value?.toLowerCase().includes(keyword)))
      : list;

    return [...filtered].sort((a, b) => a.balance - b.balance);
  }, [overview, query]);

  const access = overview?.access;
  const averageUsage = useMemo(() => {
    const list = overview?.rows ?? [];
    if (list.length === 0) return 0;
    const totalQuota = list.reduce((total, row) => total + row.totalQuota, 0);
    if (totalQuota === 0) return 0;

    return Math.round((list.reduce((total, row) => total + row.consumed, 0) / totalQuota) * 100);
  }, [overview]);

  async function savePolicy() {
    if (!draft) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/points/policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(body.error ?? "保存失败。");

      setPolicy(body.policy);
      setDraft(body.policy);
      setNotice("策略已保存。改动从下个周期起生效，当月已发放的额度不变。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function decide(action: "approve" | "reject", id: string) {
    setPending({ id, action });
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/points/requests/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(body.error ?? "处理失败。");

      setNotice(action === "approve" ? "已批准，补充额度已发放到该成员账户。" : "已驳回。");
      await load();
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : "处理失败。");
    } finally {
      setPending(null);
    }
  }

  if (loading && !overview) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载积分数据…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-bold text-muted">本周期总消耗</p>
            <p className="mt-1 text-2xl font-black text-foreground">{overview?.totals.consumed ?? 0}</p>
            <p className="mt-1 text-xs text-muted">周期 {overview?.period ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-bold text-muted">平均使用率</p>
            <p className="mt-1 text-2xl font-black text-foreground">{averageUsage}%</p>
            <p className="mt-1 text-xs text-muted">按已用 / 应发额度计算</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-bold text-muted">待审批申请</p>
            <p className="mt-1 text-2xl font-black text-foreground">{overview?.totals.pending ?? 0}</p>
            <p className="mt-1 text-xs text-muted">含所有成员的本周期申请</p>
          </CardContent>
        </Card>
      </section>

      {requests.length > 0 ? (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>待审批申请</CardTitle>
            <Badge tone="amber">{requests.length} 单</Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-0">
            {requests.map((request) => (
              <div key={request.id} className="flex flex-col gap-3 border-b border-border px-5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {request.applicantName ?? request.applicantId}
                    <span className="ml-2 font-normal text-muted">{request.requestNo}</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{request.reason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-black text-brand">+{request.requestedAmount}</span>
                  {access?.canApprove ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={Boolean(pending)} onClick={() => void decide("approve", request.id)}>
                        {pending?.id === request.id && pending.action === "approve" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        批准
                      </Button>
                      <Button size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => void decide("reject", request.id)}>
                        <X className="h-4 w-4" />
                        驳回
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">无审批权限</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>成员额度</CardTitle>
            <p className="mt-1 text-sm text-muted">按剩余额度升序排列，快用完的排在前面。</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className={`${fieldClass} sm:w-56`}
              placeholder="搜索姓名、部门"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="bg-surface-muted text-xs font-bold text-muted">
                <tr>
                  <th className="px-5 py-3 text-left">成员</th>
                  <th className="px-5 py-3 text-left">本月构成</th>
                  <th className="px-5 py-3 text-left">已用</th>
                  <th className="px-5 py-3 text-left">剩余</th>
                  <th className="px-5 py-3 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className="border-t border-border">
                    <td className="px-5 py-3">
                      <p className="font-bold text-foreground">{row.name}</p>
                      <p className="text-xs text-muted">
                        {row.department} · {row.title}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {row.baseQuota} 基础
                      {row.carriedIn > 0 ? ` + ${row.carriedIn} 结转` : ""}
                      {row.extraGranted > 0 ? ` + ${row.extraGranted} 补充` : ""}
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground">
                        {row.consumed}
                        <span className="ml-1 text-xs text-muted">/ {row.totalQuota}</span>
                      </p>
                      <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-border">
                        <div
                          className={`h-full ${usagePercent(row) >= 80 ? "bg-red-500" : usagePercent(row) >= 60 ? "bg-amber-500" : "bg-brand"}`}
                          style={{ width: `${usagePercent(row)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-base font-black ${row.balance === 0 ? "text-red-600" : "text-foreground"}`}>
                        {row.balance}
                      </span>
                      {row.reserved > 0 ? <span className="ml-1 text-xs text-amber-600">({row.reserved} 冻结)</span> : null}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {statusBadge(row)}
                        {row.pendingRequests > 0 ? <Badge tone="blue">待审批 {row.pendingRequests}</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-muted">
                      没有匹配成员。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>发放规则</CardTitle>
            <p className="mt-1 text-sm text-muted">改动只影响下个周期，当月已发放的额度不变。</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="每账号月额度">
              <input
                className={fieldClass}
                type="number"
                min={0}
                disabled={!access?.canConfigure}
                value={draft?.baseQuota ?? 50}
                onChange={(event) => setDraft((current) => (current ? { ...current, baseQuota: Number(event.target.value) } : current))}
              />
            </Field>
            <Field label="结转上限">
              <input
                className={fieldClass}
                type="number"
                min={0}
                disabled={!access?.canConfigure}
                value={draft?.carryoverCap ?? 50}
                onChange={(event) => setDraft((current) => (current ? { ...current, carryoverCap: Number(event.target.value) } : current))}
              />
            </Field>
            <p className="text-xs text-muted">
              上月未用完的额度最多结转 {draft?.carryoverCap ?? 50} 分；结转来的额度只能当月使用，不再二次结转。
            </p>
            <Field label="周期时区">
              <input
                className={fieldClass}
                disabled={!access?.canConfigure}
                value={draft?.timezone ?? "Asia/Shanghai"}
                onChange={(event) => setDraft((current) => (current ? { ...current, timezone: event.target.value } : current))}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                disabled={!access?.canConfigure}
                checked={draft?.grantToDisabled ?? false}
                onChange={(event) => setDraft((current) => (current ? { ...current, grantToDisabled: event.target.checked } : current))}
              />
              停用账号继续发放额度
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>申请与审批</CardTitle>
            <p className="mt-1 text-sm text-muted">申请人不能审批自己的申请，系统强制校验。</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="每月申请次数">
                <input
                  className={fieldClass}
                  type="number"
                  min={0}
                  disabled={!access?.canConfigure}
                  value={draft?.maxRequestsPerPeriod ?? 3}
                  onChange={(event) => setDraft((current) => (current ? { ...current, maxRequestsPerPeriod: Number(event.target.value) } : current))}
                />
              </Field>
              <Field label="单次上限">
                <input
                  className={fieldClass}
                  type="number"
                  min={1}
                  disabled={!access?.canConfigure}
                  value={draft?.maxRequestAmount ?? 200}
                  onChange={(event) => setDraft((current) => (current ? { ...current, maxRequestAmount: Number(event.target.value) } : current))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="每月补充总额上限">
                <input
                  className={fieldClass}
                  type="number"
                  min={0}
                  disabled={!access?.canConfigure}
                  value={draft?.maxExtraPerPeriod ?? 300}
                  onChange={(event) => setDraft((current) => (current ? { ...current, maxExtraPerPeriod: Number(event.target.value) } : current))}
                />
              </Field>
              <Field label="申请单有效天数">
                <input
                  className={fieldClass}
                  type="number"
                  min={1}
                  disabled={!access?.canConfigure}
                  value={draft?.requestExpireDays ?? 7}
                  onChange={(event) => setDraft((current) => (current ? { ...current, requestExpireDays: Number(event.target.value) } : current))}
                />
              </Field>
            </div>
            <Field label="余额预警阈值（%）">
              <input
                className={fieldClass}
                type="number"
                min={0}
                max={100}
                disabled={!access?.canConfigure}
                value={draft?.warnPercent ?? 20}
                onChange={(event) => setDraft((current) => (current ? { ...current, warnPercent: Number(event.target.value) } : current))}
              />
            </Field>
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
              审批权限由「账号权限」控制：owner 与管理角色默认可审批，也可在单个账号上单独开启。
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>操作定价</CardTitle>
            <p className="mt-1 text-sm text-muted">调价会发布新版本，历史流水按原价保留。</p>
          </div>
          {access?.canConfigure ? (
            <Button size="sm" disabled={saving || !draft} onClick={() => void savePolicy()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存策略
            </Button>
          ) : (
            <span className="text-xs text-muted">只读</span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="bg-surface-muted text-xs font-bold text-muted">
                <tr>
                  <th className="px-5 py-3 text-left">操作</th>
                  <th className="px-5 py-3 text-left">单价</th>
                  <th className="px-5 py-3 text-left">预扣上限</th>
                  <th className="px-5 py-3 text-left">每日免费次数</th>
                  <th className="px-5 py-3 text-left">版本</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground">{rule.label}</p>
                      <p className="text-xs text-muted">{rule.operationCode}</p>
                    </td>
                    <td className="px-5 py-3">{rule.unitCost}</td>
                    <td className="px-5 py-3">{rule.maxCost}</td>
                    <td className="px-5 py-3 text-muted">{rule.dailyFreeCount > 0 ? rule.dailyFreeCount : "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted">v{rule.version}</td>
                  </tr>
                ))}
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                      暂无定价，所有操作按免费处理。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-border bg-surface-muted px-4 py-3 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          所有额度变动都会写入不可篡改的流水，并记录操作人。手动调额必须填写原因，可在成员明细中审计。
          {policy ? ` 当前策略：每月 ${policy.baseQuota} 分，结转上限 ${policy.carryoverCap} 分。` : ""}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <Coins className="h-4 w-4" />
        积分规则说明：基础额度每月 1 日发放，审批补充额当月有效，任务失败自动退还预扣。
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-normal text-muted">{label}</span>
      {children}
    </label>
  );
}

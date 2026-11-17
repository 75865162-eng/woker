"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type PointsRow } from "./points-quick-panel";
import { type Account, type Role } from "./account-workbench-api";
import { permissionModules, type PermissionAction } from "@/lib/accounts/permissions";

type StoreGrant = {
  enabled: boolean;
  visibleStoreIds: string[] | null;
  selfGrant: { storeIds: string[]; actions: string[]; enabled: boolean; revision: number } | null;
  roleGrants: Array<{ roleId: string; storeIds: string[]; actions: string[]; enabled: boolean }>;
  stores: Array<{ id: string; name: string; externalId: string }>;
};
type LedgerRow = { id: string; createdAt: string; action?: string; amount?: number; reason?: string; label?: string };

export function AccountDetailDrawer({
  account, roles, points, onClose, onEdit,
}: {
  account: Account;
  roles: Role[];
  points?: PointsRow | null;
  onClose: () => void;
  onEdit: (account: Account) => void;
}) {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [grant, setGrant] = useState<StoreGrant | null>(null);
  const role = roles.find(r => r.id === account.roleId);

  useEffect(() => {
    let canceled = false;
    void fetch(`/api/points/ledger?userId=${encodeURIComponent(account.id)}&take=8`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((body: { rows?: LedgerRow[] } | null) => { if (!canceled && body) setLedger(body.rows ?? []); })
      .catch(() => undefined);
    void fetch("/api/sellfox/store-grants", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((body: StoreGrant | null) => { if (!canceled && body) setGrant(body); })
      .catch(() => undefined);
    return () => { canceled = true; };
  }, [account.id]);

  const storeNames = (ids: string[]) => {
    if (!grant) return ids.join("、");
    return ids.map(id => grant.stores.find(s => s.id === id)?.name ?? id).join("、") || "无";
  };
  const actions = role?.permissions ? Object.entries(role.permissions) as Array<[string, PermissionAction[]]> : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="成员详情" onMouseDown={onClose}>
      <aside className="flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-surface p-5 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{account.name}</h2>
            <p className="mt-1 text-sm text-muted">{account.department} · {account.title} · {account.id}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></Button>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">基础资料</h3>
            <Button size="sm" variant="secondary" onClick={() => onEdit(account)}>编辑</Button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">邮箱</dt><dd className="text-foreground">{account.email}</dd>
            <dt className="text-muted">登录名</dt><dd className="text-foreground">{account.username || "—"}</dd>
            <dt className="text-muted">手机号</dt><dd className="text-foreground">{account.phone || "—"}</dd>
            <dt className="text-muted">状态</dt><dd><Badge tone={account.status === "active" ? "green" : account.status === "disabled" ? "red" : "amber"}>{account.status}</Badge></dd>
            <dt className="text-muted">最近登录</dt><dd className="text-foreground">{account.lastLoginAt || "未记录"}</dd>
            <dt className="text-muted">登录 IP</dt><dd className="text-foreground">{account.lastLoginIp || "未记录"}</dd>
          </dl>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">角色与页面权限</h3>
          <p className="mt-2 text-sm text-muted">角色：{role?.name ?? account.roleId}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {actions.length ? actions.filter(([, acts]) => acts.length).map(([module, acts]) => (
              <Badge key={module} tone="blue">{permissionModules.find(m => m.id === module)?.name ?? module}：{acts.join("/")}</Badge>
            )) : <span className="text-xs text-muted">该角色未配置独立权限矩阵</span>}
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">积分账户</h3>
          {points ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">剩余 / 应发</dt><dd className="text-foreground">{points.balance} / {points.totalQuota}</dd>
              <dt className="text-muted">冻结</dt><dd className="text-foreground">{points.reserved}</dd>
              <dt className="text-muted">已用</dt><dd className="text-foreground">{points.consumed}</dd>
              <dt className="text-muted">待审批</dt><dd className="text-foreground">{points.pendingRequests}</dd>
            </dl>
          ) : <p className="mt-2 text-sm text-muted">暂无积分账户数据</p>}
          {ledger.length ? (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {ledger.map(row => <li key={row.id} className="flex justify-between"><span>{row.label ?? row.action ?? row.reason ?? "流水"}</span><span>{row.createdAt}</span></li>)}
            </ul>
          ) : null}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">数据范围授权（赛狐）</h3>
          {grant ? (
            <div className="mt-2 space-y-2 text-sm">
              <p className="text-muted">{grant.enabled ? "已启用店铺级授权" : "工作区未启用店铺级授权（继承全部店铺）"}</p>
              {grant.selfGrant ? <p className="text-foreground">本人授权店铺：{storeNames(grant.selfGrant.storeIds)}（{grant.selfGrant.enabled ? "启用" : "停用"}）</p> : <p className="text-muted">本人无独立店铺授权</p>}
              {grant.roleGrants.filter(g => g.enabled).map(g => <p key={g.roleId} className="text-foreground">角色 {g.roleId}：{storeNames(g.storeIds)}</p>)}
            </div>
          ) : <p className="mt-2 text-sm text-muted">正在加载授权数据…</p>}
          <p className="mt-2 text-xs text-muted">完整授权配置请在「角色与权限」及经营中台授权入口维护。</p>
        </div>
      </aside>
    </div>
  );
}

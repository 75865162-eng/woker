"use client";

import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PointsRow } from "./points-quick-panel";
import { fieldClass, type Account, type Role, type RoleId } from "./account-workbench-api";
import { pointsUsagePercent } from "./account-workbench-dialogs";

type Props = {
  accounts: Account[];
  roles: Role[];
  pointsByUser: Record<string, PointsRow>;
  total: number;
  page: number;
  pageCount: number;
  firstIndex: number;
  lastIndex: number;
  onPageChange: (page: number) => void;
  onRoleChange: (accountId: string, roleId: RoleId) => void;
  onEdit: (account: Account) => void;
  onToggleStatus: (accountId: string) => void;
  onArchive: (accountId: string) => void;
};

export function AccountMembersTable({ accounts, roles, pointsByUser, total, page, pageCount, firstIndex, lastIndex, onPageChange, onRoleChange, onEdit, onToggleStatus, onArchive }: Props) {
  return <>
    <div className="overflow-auto">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead className="bg-surface-muted text-xs font-bold text-muted">
          <tr>{["姓名", "手机号", "部门 / 岗位", "系统角色", "状态", "本月积分", "最近活动", "操作"].map(label => <th key={label} className={`px-5 py-3 ${label === "操作" ? "text-right" : "text-left"}`}>{label}</th>)}</tr>
        </thead>
        <tbody>{accounts.map(account => <tr key={account.id} className="border-t border-border">
          <td className="px-5 py-4"><div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-xs font-black text-brand">{account.name.slice(0, 1)}</div>
            <div><p className="font-bold text-foreground">{account.name}</p><p className="text-xs text-muted">{account.id}</p></div>
          </div></td>
          <td className="px-5 py-4 text-muted">{account.phone || account.username || account.email || "—"}</td>
          <td className="px-5 py-4"><p className="font-medium text-foreground">{account.department}</p><p className="text-xs text-muted">{account.title}</p></td>
          <td className="px-5 py-4"><select className={fieldClass} value={account.roleId} onChange={event => onRoleChange(account.id, event.target.value as RoleId)}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></td>
          <td className="px-5 py-4"><Badge tone={account.status === "active" ? "green" : account.status === "disabled" ? "red" : "amber"}>{account.status === "active" ? "正常" : account.status === "disabled" ? "已停用" : account.status === "pending" ? "待激活" : "已归档"}</Badge></td>
          <td className="px-5 py-4"><AccountPointsCell row={pointsByUser[account.id]} /></td>
          <td className="px-5 py-4"><p className="font-medium text-foreground">{account.lastLoginIp || "IP 未记录"}</p><p className="text-xs text-muted">{account.lastLoginAt || account.lastActiveAt || "时间未记录"}</p></td>
          <td className="px-5 py-4"><div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => onEdit(account)}><Pencil className="h-4 w-4" />编辑</Button>
            <Button size="sm" variant={account.status === "disabled" ? "secondary" : "danger"} onClick={() => onToggleStatus(account.id)}>{account.status === "disabled" ? "启用" : "停用"}</Button>
            <Button size="sm" variant="secondary" onClick={() => onArchive(account.id)}>归档</Button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>
    {total === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">没有找到匹配账号。</p> : null}
    <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
      <p className="text-sm text-muted">第 {page} / {pageCount} 页，显示 {firstIndex}-{lastIndex} / {total} 个账号</p>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4" />上一页</Button>
        <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))}>下一页<ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  </>;
}

function AccountPointsCell({ row }: { row?: PointsRow }) {
  if (!row) return <span className="text-xs text-muted">—</span>;
  return <div>
    <p className={`text-sm font-bold ${row.balance === 0 ? "text-danger-ink" : "text-foreground"}`}>{row.balance}<span className="ml-1 text-xs font-normal text-muted">/ {row.totalQuota}</span></p>
    <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-border"><div className="h-full bg-brand" style={{ width: `${pointsUsagePercent(row)}%` }} /></div>
    {row.pendingRequests > 0 ? <p className="mt-0.5 text-xs text-warning-ink">待审批 {row.pendingRequests}</p> : null}
  </div>;
}

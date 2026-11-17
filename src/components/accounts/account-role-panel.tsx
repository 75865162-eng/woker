"use client";

import { useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { permissionActions, permissionModules, type PermissionAction } from "@/lib/accounts/permissions";
import { canManageRole, fieldClass, type Account, type Role, type RoleId } from "./account-workbench-api";
import { DepartmentBar, Field } from "./account-workbench-dialogs";

type Props = {
  roles: Role[];
  accounts: Account[];
  activeRole?: Role;
  revision: string;
  savedAt: string;
  onSelect: (id: RoleId) => void;
  onAdd: () => void;
  onMembers: (id: RoleId) => void;
  onDelete: (id: RoleId) => void;
  onSave: () => void;
  onUpdate: (field: "name" | "description" | "sortOrder", value: string) => void;
  onTogglePermission: (moduleId: string, action: PermissionAction) => void;
  onToggleModule: (moduleId: string) => void;
};

export function AccountRolePanel({ roles, accounts, activeRole, revision, savedAt, onSelect, onAdd, onMembers, onDelete, onSave, onUpdate, onTogglePermission, onToggleModule }: Props) {
  const [manageMode, setManageMode] = useState(false);
  const departments = Array.from(new Set(accounts.map(account => account.department)));
  return <div className="overflow-x-auto"><div className="grid min-w-[760px] grid-cols-[minmax(240px,1fr)_minmax(0,2fr)] gap-3">
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2.5">
          <div><CardTitle className="text-section">角色权限</CardTitle><p className="mt-0.5 text-xs text-muted">按角色维护模块权限，新建账号时直接分配角色。</p></div>
          <div className="flex shrink-0 items-center gap-2"><Badge tone="blue">{roles.length} 个角色</Badge>
            <Button className="h-8 px-2" size="sm" variant="secondary" onClick={onAdd}><Plus className="h-3.5 w-3.5" />添加</Button>
            <Button className="h-8 px-2" size="sm" variant="secondary" onClick={() => setManageMode(value => !value)}>{manageMode ? "完成" : "管理"}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5 p-3">{roles.map(role => <div key={role.id} className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 transition ${activeRole?.id === role.id ? "border-brand bg-brand/5" : "border-border bg-surface hover:bg-surface-muted"}`}>
          <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(role.id)} type="button"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-foreground">{role.name}</p></div><p className="mt-0.5 text-xs leading-4 text-muted">{role.description}</p></button>
          <button className="shrink-0 self-start rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/5" onClick={() => onMembers(role.id)} type="button" aria-label={`查看${role.memberCount}名${role.name}成员`}>{role.memberCount} 人</button>
          {manageMode ? <button aria-label={`删除${role.name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted" disabled={role.memberCount > 0 || !canManageRole(role.id)} onClick={() => onDelete(role.id)} title={role.memberCount > 0 ? "已有成员的角色不能删除" : "删除角色"} type="button"><Trash2 className="h-4 w-4" /></button> : null}
        </div>)}</CardContent>
      </Card>
      <Card><CardHeader className="flex flex-row items-center justify-between px-4 py-3"><CardTitle className="text-section">人员分布</CardTitle><Badge tone="gray">按部门</Badge></CardHeader><CardContent className="space-y-2 p-4">{departments.map(department => {
        const count = accounts.filter(account => account.department === department).length;
        return <DepartmentBar key={department} name={department} count={count} percent={accounts.length ? Math.round(count / accounts.length * 100) : 0} />;
      })}</CardContent></Card>
    </div>
    <Card className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
      <CardHeader className="sticky top-0 z-10 flex flex-row items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2.5"><div><CardTitle className="text-section">权限管理</CardTitle><p className="mt-0.5 text-xs text-muted">{activeRole ? `${activeRole.name} 当前实际绑定 ${activeRole.memberCount} 个账号。` : "暂无可编辑角色。"}{revision ? ` 版本 ${revision}` : ""}</p></div><Button className="shrink-0 px-2" size="sm" variant="secondary" onClick={onSave}><ShieldCheck className="h-3.5 w-3.5" />保存角色</Button></CardHeader>
      <CardContent className="space-y-1.5 p-3">
        {savedAt ? <p className="text-xs font-medium text-success-ink">角色已保存：{savedAt}，页面正在刷新。</p> : null}
        {activeRole ? <>
          <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="角色名称"><input className={fieldClass} value={activeRole.name} onChange={event => onUpdate("name", event.target.value)} /></Field><Field label="排序"><input className={fieldClass} inputMode="numeric" type="number" value={activeRole.sortOrder} onChange={event => onUpdate("sortOrder", event.target.value)} /></Field></div><Field label="角色说明"><textarea className={`${fieldClass} min-h-20 resize-y`} value={activeRole.description} onChange={event => onUpdate("description", event.target.value)} /></Field></div>
          {permissionModules.map(module => <div key={module.id} className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-1.5 rounded-md border border-border px-2 py-1.5"><p className="text-xs font-bold text-foreground">{module.name.split(" /")[0]}</p><div className="grid grid-cols-6 gap-1">
            <label className="flex items-center justify-center gap-0.5 text-label font-medium text-muted"><input checked={permissionActions.every(action => activeRole.permissions[module.id]?.includes(action.id))} className="h-3.5 w-3.5 accent-brand" onChange={() => onToggleModule(module.id)} type="checkbox" />全选</label>
            {permissionActions.map(action => <label key={action.id} className="flex items-center justify-center gap-0.5 text-label font-medium text-muted"><input checked={activeRole.permissions[module.id]?.includes(action.id) ?? false} className="h-3.5 w-3.5 accent-brand" onChange={() => onTogglePermission(module.id, action.id)} type="checkbox" />{action.label}</label>)}
          </div></div>)}
        </> : <p className="rounded-md border border-border bg-surface px-3 py-8 text-center text-sm text-muted">没有可编辑的角色。</p>}
      </CardContent>
    </Card>
  </div></div>;
}

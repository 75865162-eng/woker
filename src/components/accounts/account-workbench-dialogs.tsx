"use client";

import { useState } from "react";
import { Check, Plus, UserCog, UsersRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/overlays";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { PointsQuickPanel, type PointsRow } from "@/components/accounts/points-quick-panel";
import { type RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { accountWorkbookColumns, createAccountWorkbookRows } from "@/lib/accounts/account-workbook";
import { type RoleId, type Account, type Role, fieldClass } from "./account-workbench-api";
export function MetricCard({
  title,
  value,
  note,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  note: string;
  icon: typeof UsersRound;
  tone: "blue" | "green" | "amber" | "gray";
}) {
  const colorClass = {
    blue: "border-t-blue-500 text-info-ink",
    green: "border-t-emerald-500 text-success-ink",
    amber: "border-t-amber-500 text-warning-ink",
    gray: "border-t-slate-400 text-muted",
  }[tone];

  return (
    <Card className={`border-t-4 ${colorClass}`}>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-bold text-muted">{title}</p>
          <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted">{note}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-muted">
          <Icon className={`h-5 w-5 ${colorClass}`} />
        </div>
      </CardContent>
    </Card>
  );
}

export function DepartmentBar({ name, count, percent }: { name: string; count: number; percent: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-foreground">{name}</p>
        <span className="text-sm font-black text-foreground">{count}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function ArchivedAccountsDialog({ rows, onClose }: { rows: ReturnType<typeof createAccountWorkbookRows>; onClose: () => void }) {
  return (
    <Modal title="已归档员工信息" onClose={onClose} size="wide">
      <StandardDataTable
        ariaLabel="已归档员工信息表"
        rows={rows}
        getRowKey={row => row.id}
        columns={accountWorkbookColumns.map(column => ({
          key: column,
          header: column,
          className: "whitespace-nowrap text-muted",
          headerClassName: "whitespace-nowrap",
          render: (row: ReturnType<typeof createAccountWorkbookRows>[number]) => row[column],
        }))}
        className="min-w-[1280px] text-xs"
        empty="暂无已归档员工。"
      />
    </Modal>
  );
}

export function RoleDialog({
  roles,
  onClose,
  onSubmit,
}: {
  roles: RoleCatalogItem[];
  onClose: () => void;
  onSubmit: (roleId: RoleId) => void;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<RoleId>(roles[0]?.id ?? "viewer");
  const selectedRole = roles.find((role) => role.id === selectedRoleId);

  return (
    <Modal title="添加角色" onClose={onClose}>
      {roles.length ? (
        <div className="space-y-[var(--gap-section)]">
          <Field label="角色模板">
            <select className={fieldClass} value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value as RoleId)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          {selectedRole ? (
            <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
              <p className="text-sm font-bold text-foreground">{selectedRole.name}</p>
              <p className="mt-1 text-sm leading-5 text-muted">{selectedRole.description}</p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={() => onSubmit(selectedRoleId)}>
              <Plus className="h-4 w-4" />
              添加角色
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-[var(--gap-section)]">
          <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm text-muted">暂无可添加的内置角色。</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function RoleMembersDialog({ role, accounts, onClose }: { role: Role; accounts: Account[]; onClose: () => void }) {
  const memberColumns: DataTableColumn<Account>[] = [
    {
      key: "name",
      header: "姓名",
      render: (account) => (<>{account.name}<span className="block text-xs text-muted">{account.id}</span></>),
    },
    {
      key: "contact",
      header: "手机号",
      className: "text-muted",
      render: (account) => account.phone || account.username || account.email || "—",
    },
    {
      key: "department",
      header: "部门 / 岗位",
      render: (account) => (<>{account.department}<span className="block text-xs text-muted">{account.title}</span></>),
    },
  ];

  return (
    <Modal title={`${role.name}成员`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <div>
            <p className="text-sm font-bold text-foreground">{role.name}</p>
            <p className="mt-0.5 text-xs text-muted">{role.description}</p>
          </div>
          <Badge tone="blue">{accounts.length} 人</Badge>
        </div>
        <StandardDataTable
          ariaLabel="角色成员列表"
          rows={accounts}
          getRowKey={(account) => account.id}
          columns={memberColumns}
          maxHeight="420px"
          empty="当前角色暂无绑定成员。"
        />
      </div>
    </Modal>
  );
}

export function AccountDialog({
  roles,
  title,
  onClose,
  onSubmit,
}: {
  roles: Role[];
  title: string;
  onClose: () => void;
  onSubmit: (payload: Omit<Account, "id" | "status" | "lastActiveAt">) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    department: "广告中心",
    title: "运营专员",
    roleId: "operations" as RoleId,
  });

  const ready = form.name.trim() && (form.phone.trim() || form.email.trim());

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-1 gap-[var(--gap-field)] sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="手机号">
          <input className={fieldClass} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
        <Field label="邮箱">
          <input className={fieldClass} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="部门">
          <input className={fieldClass} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
        </Field>
        <Field label="岗位">
          <input className={fieldClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="系统角色">
          <select className={fieldClass} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value as RoleId })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button disabled={!ready} onClick={() => onSubmit(form)}>
          <Check className="h-4 w-4" />
          创建账号
        </Button>
      </div>
    </Modal>
  );
}

export function EditAccountDialog({
  account,
  roles,
  onClose,
  onSubmit,
  pointsRow,
  canAdjustPoints = false,
  onPointsChanged,
}: {
  account: Account;
  roles: Role[];
  onClose: () => void;
  onSubmit: (account: Account) => void;
  pointsRow?: PointsRow | null;
  canAdjustPoints?: boolean;
  onPointsChanged?: () => void;
}) {
  const [form, setForm] = useState(account);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordChanged = password.trim().length > 0;
  const passwordReady = !passwordChanged || (password === confirmPassword && password.trim().length > 0);
  const submitDisabled = passwordChanged ? !passwordReady : false;

  return (
    <Modal title="编辑账号资料" onClose={onClose}>
      <div className="grid grid-cols-1 gap-[var(--gap-field)] sm:grid-cols-2">
        <Field label="姓名">
          <input className={fieldClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="手机号">
          <input className={fieldClass} value={form.phone || ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
        <Field label="邮箱">
          <input className={fieldClass} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="部门">
          <input className={fieldClass} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} />
        </Field>
        <Field label="系统角色">
          <select className={fieldClass} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value as RoleId })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 rounded-md border border-border bg-surface-muted px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-foreground">账号密码</p>
            <p className="mt-0.5 text-xs text-muted">留空则不修改密码。</p>
          </div>
          <div className="text-xs text-muted">登录账号：{form.phone || form.username || form.email || form.id}</div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-[var(--gap-field)] sm:grid-cols-2">
          <Field label="新密码">
            <input className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="确认密码">
            <input className={fieldClass} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </Field>
        </div>
      </div>
      <div className="mt-4">
        <PointsQuickPanel
          userId={form.id}
          userName={form.name}
          row={pointsRow ?? null}
          canAdjust={canAdjustPoints}
          onChanged={onPointsChanged}
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={submitDisabled}
          onClick={() =>
            onSubmit({
              ...form,
              password: passwordChanged ? password : account.password,
              passwordDirty: passwordChanged || account.passwordDirty,
            })
          }
        >
          <Check className="h-4 w-4" />
          保存修改
        </Button>
      </div>
    </Modal>
  );
}

export function pointsUsagePercent(row: PointsRow) {
  if (row.totalQuota <= 0) return 0;

  return Math.min(100, Math.round((row.consumed / row.totalQuota) * 100));
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-bold uppercase tracking-normal text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Modal({
  title,
  children,
  onClose,
  size = "default",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: "default" | "wide";
}) {
  const widthClass = size === "wide" ? "max-w-6xl" : "max-w-2xl";

  return (
    <Dialog open bare zIndex="modal" onClose={onClose}>
      <div className={`mx-auto w-full ${widthClass} rounded-lg bg-surface shadow-xl`} onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-white">
              <UserCog className="h-5 w-5" />
            </div>
            <h2 className="text-base font-black text-foreground">{title}</h2>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground" onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </Dialog>
  );
}

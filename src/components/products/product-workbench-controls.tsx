"use client";

import { Button } from "@/components/ui/button";
import { type AccountRoleId, filterTeamMembersByRoles, type TeamAccountRecord, type TeamMember } from "@/lib/accounts/team-roster";
import type { ProductWorkflowRole } from "@/lib/products/types";
import { fetchTeamAccountsCached } from "@/lib/workspace/workspace-api-cache";

export function SummaryTile({
  label,
  value,
  tone = "gray",
  active,
  detail,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "gray" | "blue" | "green" | "amber" | "red";
  active?: boolean;
  detail?: string;
  onClick?: () => void;
}) {
  const toneClass = {
    gray: "text-foreground",
    blue: "text-info",
    green: "text-success",
    amber: "text-accent",
    red: "text-danger",
  }[tone];

  return (
    <button
      className={`flex min-h-[82px] w-32 flex-col rounded-md border bg-surface px-3 py-2.5 text-left shadow-sm transition-colors hover:border-brand hover:bg-surface-muted ${
        active ? "border-brand ring-2 ring-brand/15" : "border-border"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-xl font-black metric-tabular ${toneClass}`}>{value}</p>
      {detail ? <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted">{detail}</p> : null}
    </button>
  );
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </Button>
      <span className="rounded-md bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
        {page} / {pageCount}
      </span>
      <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        下一页
      </Button>
      <select
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs font-semibold text-foreground"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>
            {option} 条 / 页
          </option>
        ))}
      </select>
    </div>
  );
}

export async function loadTeamAccountsFromApi() {
  try {
    const data = await fetchTeamAccountsCached();
    return data.accounts;
  } catch {
    return [];
  }
}

export function getTeamMemberOptions(members: TeamMember[], roles: ProductWorkflowRole[]) {
  return Array.from(new Set(filterTeamMembersByRoles(members, roles).map((member) => member.name.trim()).filter(Boolean)));
}

export function getAccountNameOptionsByRoleIds(accounts: TeamAccountRecord[], roleIds: AccountRoleId[]) {
  const roleSet = new Set<AccountRoleId>(roleIds);
  const names = accounts
    .filter((account) => account.status !== "disabled" && account.status !== "archived" && roleSet.has(account.roleId))
    .map((account) => account.name.trim())
    .filter(Boolean);

  return Array.from(new Set(names));
}

"use client";

import { useRef, useState } from "react";
import { exportAccountWorkbook, parseAccountWorkbookFile } from "@/lib/accounts/account-workbook";
import { canManageAccount, canManageRole, downloadBlob, getFallbackPassword, isDefaultSuperAccount, type Account, type RoleId } from "./account-workbench-api";

type Options = {
  accounts: Account[];
  roleLabels: Record<RoleId, string>;
  commitAccounts: (updater: (current: Account[]) => Account[]) => void;
  setError: (message: string) => void;
};

export function useAccountWorkbookTransfer({ accounts, roleLabels, commitAccounts, setError }: Options) {
  const [accountImportMessage, setAccountImportMessage] = useState("");
  const [accountImporting, setAccountImporting] = useState(false);
  const accountImportInputRef = useRef<HTMLInputElement | null>(null);

  async function exportAccounts() {
    const blob = await exportAccountWorkbook(accounts, roleLabels);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadBlob(blob, `账号列表-${stamp}.xlsx`);
  }

  async function importAccounts(file: File) {
    setAccountImportMessage("");
    setError("");
    setAccountImporting(true);
    try {
      const { accounts: importedAccounts, errors } = await parseAccountWorkbookFile(file, roleLabels);
      if (!importedAccounts.length) throw new Error(errors[0] ?? "文件中没有可导入的有效账号。");
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = errors.length;
      commitAccounts(current => {
        const next = [...current];
        importedAccounts.forEach((imported, index) => {
          const existingIndex = next.findIndex(account => account.id === imported.id || (Boolean(imported.username) && account.username === imported.username) || (Boolean(imported.phone) && account.phone === imported.phone) || (Boolean(imported.email) && account.email.trim().toLowerCase() === imported.email?.toLowerCase()));
          if (existingIndex >= 0) {
            const existing = next[existingIndex];
            if (!canManageAccount(existing) || !canManageRole(imported.roleId)) { skippedCount++; return; }
            next[existingIndex] = {
              ...existing, id: existing.id, name: imported.name, roleId: imported.roleId, status: imported.status,
              username: imported.username || existing.username, email: imported.email || existing.email,
              department: imported.department || existing.department, title: imported.title || existing.title,
              password: imported.password || existing.password,
              passwordDirty: Boolean(imported.password) || (existing.passwordDirty ?? false),
              lastActiveAt: imported.lastActiveAt || existing.lastActiveAt,
              amazonStorePermissions: imported.amazonStorePermissions || existing.amazonStorePermissions,
              multiPlatformStorePermissions: imported.multiPlatformStorePermissions || existing.multiPlatformStorePermissions,
              phone: imported.phone || existing.phone, lastLoginIp: imported.lastLoginIp || existing.lastLoginIp,
              lastLoginAt: imported.lastLoginAt || existing.lastLoginAt, sourceCreatedAt: imported.sourceCreatedAt || existing.sourceCreatedAt,
            };
            updatedCount++;
            return;
          }
          if (isDefaultSuperAccount(imported) || !canManageRole(imported.roleId)) { skippedCount++; return; }
          const id = `u-${Date.now()}-${index + 1}`;
          next.unshift({
            id, username: imported.username ?? "", name: imported.name, email: imported.email ?? "",
            department: imported.department, title: imported.title, roleId: imported.roleId, status: imported.status,
            password: imported.password || getFallbackPassword({ id, email: imported.email ?? "", username: imported.username ?? "" }),
            passwordDirty: true, lastActiveAt: imported.lastActiveAt || "待首次登录",
            amazonStorePermissions: imported.amazonStorePermissions ?? "", multiPlatformStorePermissions: imported.multiPlatformStorePermissions ?? "",
            phone: imported.phone ?? "", lastLoginIp: imported.lastLoginIp ?? "", lastLoginAt: imported.lastLoginAt ?? "", sourceCreatedAt: imported.sourceCreatedAt ?? "",
          });
          createdCount++;
        });
        return next;
      });
      setAccountImportMessage(`已导入：新增 ${createdCount} 个，更新 ${updatedCount} 个${skippedCount ? `，跳过 ${skippedCount} 行` : ""}。`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "账号列表导入失败。");
    } finally {
      setAccountImporting(false);
      if (accountImportInputRef.current) accountImportInputRef.current.value = "";
    }
  }
  return { accountImportMessage, accountImporting, accountImportInputRef, exportAccounts, importAccounts };
}

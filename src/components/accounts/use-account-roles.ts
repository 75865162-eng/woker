"use client";

import { useEffect, useMemo, useState } from "react";
import { permissionActions, type PermissionAction } from "@/lib/accounts/permissions";
import type { RoleCatalogItem } from "@/lib/accounts/role-catalog";
import { canManageRole, defaultRoleCatalog, loadRolesFromApi, normalizeRoleCatalogItem, saveRolesToApi, type Account, type Role, type RoleId } from "./account-workbench-api";

export function useAccountRoles(serverRoles: RoleCatalogItem[] | undefined, accounts: Account[]) {
  const [roles, setRoles] = useState<Role[]>(() => (serverRoles ?? defaultRoleCatalog).map(role => ({ ...role, id: role.id as RoleId, memberCount: 0 })));
  const [activeRoleId, setActiveRoleId] = useState<RoleId>("operations");
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [roleMembersOpen, setRoleMembersOpen] = useState(false);
  const [roleSavedAt, setRoleSavedAt] = useState("");
  const [roleRevision, setRoleRevision] = useState("");
  useEffect(() => {
    if (serverRoles) return;
    let canceled = false;
    void loadRolesFromApi().then(payload => {
      if (canceled || !payload) return;
      setRoleRevision(payload.revision);
      setRoles(payload.roles);
    });
    return () => { canceled = true; };
  }, [serverRoles]);
  const visibleRoles = useMemo(() => roles.map(role => ({ ...role, memberCount: accounts.filter(account => account.roleId === role.id).length })), [roles, accounts]);
  const activeRole = visibleRoles.find(role => role.id === activeRoleId) ?? visibleRoles[0];
  const activeRoleMembers = useMemo(() => activeRole ? accounts.filter(account => account.roleId === activeRole.id) : [], [activeRole, accounts]);
  const availableRoleTemplates = useMemo(() => defaultRoleCatalog.filter(role => !roles.some(item => item.id === role.id) && canManageRole(role.id)), [roles]);
  function updateRole(updater: (role: Role) => Role) { setRoles(current => current.map(role => role.id === activeRole?.id ? updater(role) : role)); }
  function togglePermission(moduleId: string, action: PermissionAction) {
    updateRole(role => {
      const actions = role.permissions[moduleId] ?? [];
      return { ...role, permissions: { ...role.permissions, [moduleId]: actions.includes(action) ? actions.filter(item => item !== action) : [...actions, action] } };
    });
  }
  function toggleModulePermissions(moduleId: string) {
    updateRole(role => ({ ...role, permissions: { ...role.permissions, [moduleId]: permissionActions.every(action => role.permissions[moduleId]?.includes(action.id)) ? [] : permissionActions.map(action => action.id) } }));
  }
  function updateActiveRole(field: "name" | "description" | "sortOrder", value: string) { updateRole(role => ({ ...role, [field]: field === "sortOrder" ? Number(value) || 0 : value })); }
  async function saveRoles() {
    const result = await saveRolesToApi(roles);
    setRoleRevision(result.revision);
    setRoleSavedAt(`${new Date().toLocaleString("zh-CN", { hour12: false })}${result.ok ? "" : "（保存失败）"}`);
    if (result.ok) { setRoles(result.roles ?? roles); window.setTimeout(() => window.location.reload(), 250); }
  }
  function addRole(id: RoleId) {
    const role = defaultRoleCatalog.find(item => item.id === id);
    if (!role) return;
    setRoles(current => current.some(item => item.id === role.id) ? current : [...current, normalizeRoleCatalogItem(role)]);
    setActiveRoleId(role.id);
    setNewRoleOpen(false);
  }
  function deleteRole(id: RoleId) {
    const role = visibleRoles.find(item => item.id === id);
    if (!role || role.memberCount > 0 || !canManageRole(role.id)) return;
    const next = roles.filter(item => item.id !== id);
    setRoles(next);
    if (activeRoleId === id && next[0]) setActiveRoleId(next[0].id);
    setRoleMembersOpen(false);
    void saveRolesToApi(next).then(result => {
      setRoleRevision(result.revision);
      setRoleSavedAt(`${new Date().toLocaleString("zh-CN", { hour12: false })}${result.ok ? "" : "（保存失败）"}`);
      if (result.ok) setRoles(result.roles ?? next);
      else void loadRolesFromApi().then(payload => { if (payload) setRoles(payload.roles); });
    });
  }
  return { roles, visibleRoles, activeRole, setActiveRoleId, activeRoleMembers, availableRoleTemplates, newRoleOpen, setNewRoleOpen, roleMembersOpen, setRoleMembersOpen, roleSavedAt, roleRevision, togglePermission, toggleModulePermissions, updateActiveRole, saveRoles, addRole, deleteRole };
}

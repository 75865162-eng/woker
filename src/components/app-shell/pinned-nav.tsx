"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getModuleIdForPath, roleCanAccessModule, type RolePermissionMap } from "@/lib/accounts/permissions";
import { navigationItemIndex, type NavigationItem } from "./business-navigation";

const PINNED_KEY = "nav.pinnedItems.v1";

function readArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeArray(key: string, value: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用时保持内存态，不影响当前会话交互。
  }
}

/** 稳定 id 才能通过校验：不存在的 id 与无权限的条目都被剔除，杜绝幽灵入口与越权固定。 */
function sanitizePinned(ids: string[], userRole: string | undefined, rolePermissions: RolePermissionMap | null): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const found = navigationItemIndex.get(id);
    if (!found) continue;
    const moduleId = found.item.moduleId ?? getModuleIdForPath(found.item.href.split("?")[0]);
    if (!roleCanAccessModule(userRole, moduleId, rolePermissions)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

type PinnedNavValue = {
  /** 经权限与存在性过滤后的固定项 id，保持用户排序。 */
  pinnedIds: string[];
  isPinned: (id: string) => boolean;
  /** 切换固定状态：仅改变展示位置，不改归属/URL/moduleId。 */
  togglePin: (id: string) => void;
  /** 同一一级类目内重排，顺序持久化。 */
  reorderInGroup: (groupId: string, orderedIds: string[]) => void;
  /** 按一级类目归类的固定条目（保持用户排序）。 */
  pinnedByGroup: Map<string, NavigationItem[]>;
};

const PinnedNavContext = createContext<PinnedNavValue | null>(null);

export function PinnedNavProvider({
  userRole,
  rolePermissions,
  children,
}: {
  userRole: string | undefined;
  rolePermissions: RolePermissionMap | null;
  children: React.ReactNode;
}) {
  const [rawPinned, setRawPinned] = useState<string[]>([]);

  // 客户端挂载后读取持久化数据，避免 SSR 内容与首屏不一致。
  useEffect(() => {
    setRawPinned(readArray(PINNED_KEY));
  }, []);

  // 多标签页同步：其他标签改动固定项时本标签跟随更新。
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === PINNED_KEY) setRawPinned(readArray(PINNED_KEY));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pinnedIds = useMemo(
    () => sanitizePinned(rawPinned, userRole, rolePermissions),
    [rawPinned, userRole, rolePermissions],
  );

  // 权限或菜单变化后，把被剔除的 id 从存储中清掉，避免残留脏数据。
  useEffect(() => {
    if (pinnedIds.length !== rawPinned.length) writeArray(PINNED_KEY, pinnedIds);
  }, [pinnedIds, rawPinned]);

  const togglePin = useCallback((id: string) => {
    if (!navigationItemIndex.has(id)) return;
    setRawPinned((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      writeArray(PINNED_KEY, next);
      return next;
    });
  }, []);

  const reorderInGroup = useCallback((groupId: string, orderedIds: string[]) => {
    setRawPinned((current) => {
      const next: string[] = [];
      let cursor = 0;
      const groupIdsInOrder = new Set(orderedIds);
      for (const id of current) {
        if (navigationItemIndex.get(id)?.groupId === groupId) {
          if (cursor < orderedIds.length) {
            next.push(orderedIds[cursor]);
            cursor += 1;
          }
        } else {
          next.push(id);
        }
      }
      // 若 orderedIds 含有当前尚未写入的项，补齐到本组位置。
      while (cursor < orderedIds.length) {
        const remaining = orderedIds[cursor];
        if (!groupIdsInOrder.has(remaining)) break;
        next.push(remaining);
        cursor += 1;
      }
      writeArray(PINNED_KEY, next);
      return next;
    });
  }, []);

  const pinnedByGroup = useMemo(() => {
    const map = new Map<string, NavigationItem[]>();
    for (const id of pinnedIds) {
      const found = navigationItemIndex.get(id);
      if (!found) continue;
      const list = map.get(found.groupId) ?? [];
      list.push(found.item);
      map.set(found.groupId, list);
    }
    return map;
  }, [pinnedIds]);

  const value = useMemo<PinnedNavValue>(() => ({
    pinnedIds,
    isPinned: (id) => pinnedIds.includes(id),
    togglePin,
    reorderInGroup,
    pinnedByGroup,
  }), [pinnedIds, togglePin, reorderInGroup, pinnedByGroup]);

  return <PinnedNavContext.Provider value={value}>{children}</PinnedNavContext.Provider>;
}

export function usePinnedNav(): PinnedNavValue {
  const context = useContext(PinnedNavContext);
  if (!context) throw new Error("usePinnedNav 必须在 PinnedNavProvider 内使用");
  return context;
}

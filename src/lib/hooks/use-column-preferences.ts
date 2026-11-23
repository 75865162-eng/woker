"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";

/**
 * 自定义列的可见键 + 顺序：localStorage 立即应用（防闪烁），服务端 UserPreference 为真值（跨设备）。
 * 写入时两者同时更新；未登录或接口失败时仅本机生效，不阻断交互。
 * key 走 user-preferences 的 `replica-columns:<tableId>` 命名空间，与列宽偏好隔离。
 */
export function useColumnPreferences(tableId: string, defaults: string[]) {
  const user = useAppShellUser();
  const storageKey = `sellfox-replica-columns:${user?.organizationId ?? "unbound"}:${user?.userId ?? "unbound"}:${tableId}`;
  const apiPath = `/api/user-preferences/replica-columns:${encodeURIComponent(tableId)}`;
  const defaultRef = useRef(defaults);
  defaultRef.current = defaults;
  const [visible, setVisible] = useState<string[]>(defaults);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  // 保存代次：用户主动保存后，任何在途的 GET 覆盖都应被忽略，避免旧服务端值回滚刚保存的选择。
  const generationRef = useRef(0);

  useEffect(() => {
    readyRef.current = false;
    setReady(false);
    let cancelled = false;
    const generation = generationRef.current;
    // 1) 本地缓存先行（但要用当前页的已知列过滤，避免跨页串列）。
    // 兼容旧版本键 `sellfox-replica-columns:<tableId>`：迁移到用户隔离键，避免丢失既有偏好。
    const legacyKey = `sellfox-replica-columns:${tableId}`;
    try {
      const cachedRaw = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyKey);
      if (cachedRaw) {
        const keys = JSON.parse(cachedRaw) as unknown;
        if (Array.isArray(keys) && keys.every((key) => typeof key === "string")) {
          const known = keys.filter((key) => defaultRef.current.includes(key));
          if (known.length && !cancelled) {
            setVisible(known);
            if (window.localStorage.getItem(legacyKey)) {
              window.localStorage.removeItem(legacyKey);
              window.localStorage.setItem(storageKey, JSON.stringify(known));
            }
          }
        }
      }
    } catch { /* 本地缓存损坏则忽略 */ }
    // 2) 服务端为真值覆盖。
    fetch(apiPath, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { value?: { visible?: string[] } | null } | null) => {
        if (cancelled || generation !== generationRef.current) return;
        const serverKeys = data?.value?.visible;
        if (Array.isArray(serverKeys) && serverKeys.length) {
          const known = serverKeys.filter((key) => defaultRef.current.includes(key));
          if (known.length) {
            setVisible(known);
            try { window.localStorage.setItem(storageKey, JSON.stringify(known)); } catch { /* 忽略 */ }
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) { readyRef.current = true; setReady(true); }
      });
    return () => { cancelled = true; };
  }, [apiPath, storageKey, tableId]);

  const saveVisible = useCallback((next: string[]) => {
    const known = next.filter((key) => defaultRef.current.includes(key));
    const finalKeys = known.length ? known : defaultRef.current;
    // 使用代次自增使在途 GET 失效，避免加载竞态把刚保存的选择覆盖回旧值。
    // 用户主动保存即真值，无需等待 ready；未登录时 PUT 会被接口 401 拒绝，本机仍生效。
    generationRef.current += 1;
    readyRef.current = true;
    setVisible(finalKeys);
    try { window.localStorage.setItem(storageKey, JSON.stringify(finalKeys)); } catch { /* 忽略 */ }
    fetch(apiPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visible: finalKeys }),
    }).catch(() => undefined);
    return finalKeys;
  }, [apiPath, storageKey]);

  return { visible, setVisible, saveVisible, ready };
}

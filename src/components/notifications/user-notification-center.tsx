"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanAccessModule } from "@/lib/accounts/permissions";
import { getProductWorkflowNotificationLink, mergeWorkspaceScope } from "@/lib/notifications/user-notification-helpers";
import { emitWorkspaceScopeChanged } from "@/lib/workspace/workspace-scope-events";

type UserNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
  readAt?: string | null;
  createdAt: string;
};

function formatNotificationTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-CN", { hour12: false });
}

export function UserNotificationCenter() {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [pendingWorkflow, setPendingWorkflow] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<UserNotification | null>(null);
  const [popupIndex, setPopupIndex] = useState(0);
  const [actionError, setActionError] = useState("");
  const shellUser = useAppShellUser();
  const canViewProducts = roleCanAccessModule(shellUser?.userRole, "products", shellUser?.rolePermissions);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupPanelRef = useRef<HTMLDivElement | null>(null);
  const workflowSessionRef = useRef<string | null>(null);
  const workflowDismissedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const shownIdsRef = useRef<Set<string>>(new Set());
  const notificationsRef = useRef(notifications);

  const loadNotifications = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    const response = await fetch("/api/notifications/user?limit=50", { cache: "no-store" }).catch(() => null);
    if (!response) return;
    const data = (await response.json().catch(() => ({}))) as {
      notifications?: UserNotification[];
      unreadCount?: number;
      pendingWorkflowNotifications?: UserNotification[];
      notificationSessionKey?: string;
    };

    if (!response.ok || sequence !== loadSequenceRef.current) {
      return;
    }

    const nextNotifications = Array.isArray(data.notifications) ? data.notifications : [];
    const unread = nextNotifications.filter((item) => !item.readAt);

    setNotifications(nextNotifications);
    setUnreadCount(data.unreadCount ?? unread.length);

    const pending = canViewProducts && Array.isArray(data.pendingWorkflowNotifications) ? data.pendingWorkflowNotifications : [];
    setPendingWorkflow(pending);
    const sessionKey = data.notificationSessionKey;
    if (sessionKey && workflowSessionRef.current !== sessionKey) {
      workflowSessionRef.current = sessionKey;
      workflowDismissedRef.current = false;
      shownIdsRef.current.clear();
      setPopup(null);
    }
    const storageKey = `workflow-popup:${shellUser?.organizationId ?? ""}:${shellUser?.userId ?? ""}`;
    let alreadyShown = workflowDismissedRef.current;
    try {
      alreadyShown ||= localStorage.getItem(storageKey) === sessionKey;
    } catch { /* In-memory suppression still works when browser storage is unavailable. */ }
    if (pending.length && sessionKey && !alreadyShown) {
      workflowDismissedRef.current = true;
      try {
        localStorage.setItem(storageKey, sessionKey);
      } catch { /* The current mount still suppresses repeated polling. */ }
      setPopupIndex(0);
      setPopup(pending[0]);
    } else {
      // Keep an open reminder aligned with task completion, without reopening a dismissed one.
      setPopup((current) => current?.type.startsWith("product_workflow")
        ? (pending.length ? current : null)
        : current);
      const nextPopup = unread.find((item) => !item.type.startsWith("product_workflow") && !shownIdsRef.current.has(item.id));
      if (nextPopup) {
        shownIdsRef.current.add(nextPopup.id);
        setPopup((current) => current ?? nextPopup);
      }
    }
    notificationsRef.current = nextNotifications;
  }, [canViewProducts, shellUser?.organizationId, shellUser?.userId]);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 15000);

    return () => {
      window.clearInterval(timer);
      ++loadSequenceRef.current;
    };
  }, [loadNotifications]);

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;

    const unreadIds = new Set(notificationsRef.current.filter((item) => ids.includes(item.id) && !item.readAt).map((item) => item.id));

    const response = await fetch("/api/notifications/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => null);
    if (!response?.ok) {
      setActionError("已读状态保存失败，请重试。");
      return false;
    }
    const readAt = new Date().toISOString();
    notificationsRef.current = notificationsRef.current.map((item) => (ids.includes(item.id) ? { ...item, readAt } : item));
    setNotifications(notificationsRef.current);
    setUnreadCount((current) => Math.max(0, current - unreadIds.size));
    setActionError("");
    return true;
  }, []);

  async function markAllRead() {
    const response = await fetch("/api/notifications/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => null);
    if (!response?.ok) { setActionError("已读状态保存失败，请重试。"); return; }
    const readAt = new Date().toISOString();
    notificationsRef.current = notificationsRef.current.map((item) => ({ ...item, readAt: item.readAt || readAt }));
    setNotifications(notificationsRef.current);
    setUnreadCount(0);
  }

  const popupWorkflow = popup?.type.startsWith("product_workflow") ? pendingWorkflow : [];
  const displayedPopupIndex = Math.min(popupIndex, Math.max(0, popupWorkflow.length - 1));
  const popupItem = popupWorkflow.length ? popupWorkflow[displayedPopupIndex] : popup;
  const popupMetadata = popupItem?.metadata && typeof popupItem.metadata === "object" ? popupItem.metadata as Record<string, unknown> : {};
  const popupDueAt = typeof popupMetadata.dueAt === "string" ? popupMetadata.dueAt : "";
  const overdue = popupItem?.type === "product_workflow_overdue" || (popupDueAt && new Date(popupDueAt).getTime() < Date.now());
  const popupLink = popupItem ? getProductWorkflowNotificationLink(popupItem) : null;
  const closePopup = useCallback(() => {
    setPopup(null);
    if (popupItem && !popupItem.type.startsWith("product_workflow")) void markRead([popupItem.id]);
  }, [markRead, popupItem]);
  async function openNotificationProduct(item: UserNotification) {
    const link = getProductWorkflowNotificationLink(item);
    if (!link || !(await markRead([item.id]))) return;
    const scope = mergeWorkspaceScope(localStorage.getItem("amazon_bulk_ad_workspace_scope"), link.workspaceId);
    try {
      localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify(scope));
      document.cookie = `amazon_bulk_ad_workspace_scope=${encodeURIComponent(JSON.stringify(scope))}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch { /* Navigation still carries explicit workspace scope. */ }
    emitWorkspaceScopeChanged({ ...scope, source: "manual" });
    window.location.assign(link.href);
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (popup && target && !popupPanelRef.current?.contains(target)) {
        closePopup();
        return;
      }

      if (open && target && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (popup) {
          closePopup();
        }
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, popup, closePopup]);

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-white text-muted transition-colors hover:border-brand hover:text-brand",
            open && "border-brand text-brand",
          )}
          title="通知"
          onClick={() => setOpen((current) => !current)}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
        {open ? (
          <div className="absolute right-0 top-full z-40 mt-2 flex max-h-[70vh] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div>
                <p className="text-sm font-bold text-foreground">通知</p>
                <p className="text-xs font-medium text-muted">业务流转和处理提醒</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => void loadNotifications()}>刷新</Button>
                <Button variant="ghost" size="sm" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
                  <CheckCheck className="h-4 w-4" />
                  全部已读
                </Button>
              </div>
            </div>
            <div className="thin-scrollbar flex-1 overflow-y-auto p-2">
              {notifications.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md px-3 py-2 transition-colors hover:bg-surface-muted"
                >
                  <button type="button" className="block w-full text-left" onClick={() => void markRead([item.id])}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-foreground">{item.title}</p>
                      {!item.readAt ? <span className="mt-1 h-2 w-2 flex-none rounded-full bg-brand" /> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-muted">{item.message}</p>
                    <p className="mt-1 text-[11px] font-medium text-muted">{formatNotificationTime(item.createdAt)}</p>
                  </button>
                  {item.type.startsWith("product_workflow") ? <Button size="sm" variant="secondary" className="mt-2" disabled={!canViewProducts || !getProductWorkflowNotificationLink(item)} title={!canViewProducts ? "没有商品查看权限" : undefined} onClick={() => void openNotificationProduct(item)}>打开商品</Button> : null}
                </div>
              ))}
              {!notifications.length ? <div className="px-3 py-8 text-center text-sm font-medium text-muted">暂无通知。</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      {popup ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 px-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePopup();
            }
          }}
        >
          <div ref={popupPanelRef} className="w-full max-w-xl rounded-lg border border-border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-bold text-foreground">业务流转提醒</p>
                <p className="mt-0.5 text-xs font-medium text-muted">每次登录提示尚未完成的任务，关闭后本次登录不再弹出</p>
              </div>
              <button type="button" className="rounded-md p-1 text-muted transition-colors hover:bg-surface-muted hover:text-foreground" title="关闭" onClick={closePopup}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <p className="text-lg font-bold text-foreground">{popupItem?.title}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-muted">{popupItem?.message}</p>
              </div>
              {popupItem?.type.startsWith("product_workflow") ? <div className={cn("rounded-md border px-3 py-3 text-sm font-medium", overdue ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
                处理期限：{popupDueAt ? formatNotificationTime(popupDueAt) : "期限未设置"}{overdue ? "（已超时）" : ""}
              </div> : null}
              {actionError ? <p role="alert" className="text-sm text-red-700">{actionError} <button className="underline" onClick={() => void markRead([popupItem?.id ?? ""])}>重试</button></p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                {popupWorkflow.length > 1 ? <Button variant="secondary" onClick={() => setPopupIndex((current) => (Math.min(current, popupWorkflow.length - 1) + 1) % popupWorkflow.length)}>下一条（{displayedPopupIndex + 1}/{popupWorkflow.length}）</Button> : null}
                <Button variant="secondary" onClick={closePopup}>
                  <X className="h-4 w-4" />
                  关闭提醒
                </Button>
                {popupItem?.type.startsWith("product_workflow") && canViewProducts ? <Button onClick={() => void openNotificationProduct(popupItem)} disabled={!popupLink} title={!popupLink ? "通知缺少商品或工作区信息" : undefined}>打开商品</Button> : null}
                <Button onClick={closePopup}>
                  <Bell className="h-4 w-4" />
                  知道了
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

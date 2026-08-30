"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<UserNotification | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupPanelRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const shownIdsRef = useRef<Set<string>>(new Set());

  const loadNotifications = useCallback(async () => {
    const response = await fetch("/api/notifications/user?limit=50", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as {
      notifications?: UserNotification[];
      unreadCount?: number;
    };

    if (!response.ok) {
      return;
    }

    const nextNotifications = Array.isArray(data.notifications) ? data.notifications : [];
    const unread = nextNotifications.filter((item) => !item.readAt);

    setNotifications(nextNotifications);
    setUnreadCount(data.unreadCount ?? unread.length);

    const nextPopup = unread.find((item) => item.type === "product_workflow" && !shownIdsRef.current.has(item.id)) ?? unread.find((item) => !shownIdsRef.current.has(item.id));
    if (nextPopup) {
      shownIdsRef.current.add(nextPopup.id);
      setPopup(nextPopup);
    }
    initializedRef.current = true;
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;

    const unreadIds = new Set(notifications.filter((item) => ids.includes(item.id) && !item.readAt).map((item) => item.id));

    await fetch("/api/notifications/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
    setNotifications((current) => current.map((item) => (ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item)));
    setUnreadCount((current) => Math.max(0, current - unreadIds.size));
  }, [notifications]);

  async function markAllRead() {
    await fetch("/api/notifications/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }

  const closePopup = useCallback(() => {
    const currentPopup = popup;
    setPopup(null);
    if (currentPopup) {
      void markRead([currentPopup.id]);
    }
  }, [markRead, popup]);

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
              <Button variant="ghost" size="sm" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
                <CheckCheck className="h-4 w-4" />
                全部已读
              </Button>
            </div>
            <div className="thin-scrollbar flex-1 overflow-y-auto p-2">
              {notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-muted"
                  onClick={() => void markRead([item.id])}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-bold text-foreground">{item.title}</p>
                    {!item.readAt ? <span className="mt-1 h-2 w-2 flex-none rounded-full bg-brand" /> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-muted">{item.message}</p>
                  <p className="mt-1 text-[11px] font-medium text-muted">{formatNotificationTime(item.createdAt)}</p>
                </button>
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
                <p className="mt-0.5 text-xs font-medium text-muted">登录后自动提示当前账号相关的新任务</p>
              </div>
              <button type="button" className="rounded-md p-1 text-muted transition-colors hover:bg-surface-muted hover:text-foreground" title="关闭" onClick={closePopup}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <p className="text-lg font-bold text-foreground">{popup.title}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-muted">{popup.message}</p>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-800">
                处理期限：{formatNotificationTime(popup.createdAt)}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={closePopup}>
                  <X className="h-4 w-4" />
                  关闭并标记已读
                </Button>
                <Button onClick={() => void closePopup()}>
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

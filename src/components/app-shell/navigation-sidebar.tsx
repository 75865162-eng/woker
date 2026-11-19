"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavigationGroup, NavigationItem } from "./business-navigation";
import { usePinnedNav } from "./pinned-nav";

type Anchor = { left: number; top: number };

/** 一级类目常驻 + 右侧二级浮层（portal）+ Pin 固定入口。 */
export function NavigationSidebar({
  groups,
  navCollapsed,
  isActive,
}: {
  groups: NavigationGroup[];
  navCollapsed: boolean;
  isActive: (href: string) => boolean;
}) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    isPinned,
    togglePin,
    reorderInGroup,
    pinnedByGroup,
  } = usePinnedNav();

  useEffect(() => setMounted(true), []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenGroupId(null), 180);
  }, [cancelClose]);

  const openGroup = useCallback((groupId: string, button: HTMLElement) => {
    cancelClose();
    const rect = button.getBoundingClientRect();
    // 浮层贴侧栏右缘：用 aside 的右边界，避免压住一级栏文字。
    const aside = button.closest("aside");
    const left = aside ? aside.getBoundingClientRect().right + 4 : rect.right + 6;
    setAnchor({ left, top: rect.top });
    setOpenGroupId(groupId);
  }, [cancelClose]);

  const closeNow = useCallback(() => {
    cancelClose();
    setOpenGroupId(null);
  }, [cancelClose]);

  const activeGroupId = groups.find((group) => group.items.some((item) => isActive(item.href)))?.id ?? null;
  const activeFlyoutGroup = groups.find((group) => group.id === openGroupId) ?? null;

  return (
    <nav
      aria-label="业务导航"
      className={cn("relative min-h-0 flex-1 overflow-y-auto pb-4 pt-1", navCollapsed ? "px-1.5" : "px-2")}
      onScroll={closeNow}
      onMouseLeave={scheduleClose}
    >
      {groups.map((group) => {
        const isOpen = openGroupId === group.id;
        const pinnedItems = pinnedByGroup.get(group.id) ?? [];
        const groupActive = activeGroupId === group.id;

        return (
          <div key={group.id} className="relative mb-0.5">
            <div className="flex items-center">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${group.label} 二级菜单`}
                title={navCollapsed ? group.label : undefined}
                onMouseEnter={(event) => openGroup(group.id, event.currentTarget)}
                onFocus={(event) => openGroup(group.id, event.currentTarget)}
                // 点击必须幂等地「打开」：鼠标移入已先触发 onMouseEnter 打开浮层，
                // 若此处再按 isOpen 切换为关闭，用户点击时浮层会瞬间消失，表现为「点击没反应」。
                // 关闭只交由 onMouseLeave(含延迟) 与滚动处理，触屏无 hover 时点击也能打开。
                onClick={(event) => openGroup(group.id, event.currentTarget)}
                className={cn(
                  "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-body leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                  navCollapsed ? "justify-center px-0" : "px-2.5",
                  isOpen || groupActive
                    ? "bg-surface-muted font-semibold text-foreground"
                    : "text-foreground/80 hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <group.icon aria-hidden className="h-4 w-4 shrink-0" />
                <span className={cn("truncate text-left", navCollapsed && "sr-only")}>{group.label}</span>
              </button>
            </div>

            {/* 固定入口：常驻在所属一级类目下方，始终持久展示；收起态不显示文字 */}
            {!navCollapsed && pinnedItems.length > 0 ? (
              <div className="mb-1 mt-0.5 space-y-0.5 border-l-2 border-brand/40 pl-2">
                {pinnedItems.map((item) => (
                  <PinnedRow
                    key={item.id}
                    item={item}
                    allIds={pinnedItems.map((entry) => entry.id)}
                    isActive={isActive(item.href)}
                    onTogglePin={() => togglePin(item.id)}
                    onReorder={(orderedIds) => reorderInGroup(group.id, orderedIds)}
                  />
                ))}
                {pinnedItems.length > 5 ? (
                  <p className="px-2 pt-0.5 text-micro text-muted">固定入口较多，侧栏可能变长</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* 二级浮层渲染到 body，避开侧栏滚动容器的裁切 */}
      {mounted && activeFlyoutGroup && anchor
        ? createPortal(
            <Flyout
              group={activeFlyoutGroup}
              isActive={isActive}
              isPinned={isPinned}
              onTogglePin={togglePin}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              anchor={anchor}
            />,
            document.body,
          )
        : null}
    </nav>
  );
}

/** 固定入口行：可点击跳转、可取消固定、可同组拖拽排序。 */
function PinnedRow({
  item,
  allIds,
  isActive,
  onTogglePin,
  onReorder,
}: {
  item: NavigationItem;
  allIds: string[];
  isActive: boolean;
  onTogglePin: () => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer.getData("text/plain");
        if (!sourceId || !allIds.includes(sourceId) || sourceId === item.id) return;
        const next = [...allIds];
        const from = next.indexOf(sourceId);
        const to = next.indexOf(item.id);
        if (from < 0 || to < 0) return;
        next.splice(from, 1);
        next.splice(to, 0, sourceId);
        onReorder(next);
      }}
      className={cn(
        "group flex min-h-8 items-center gap-1 rounded-md transition-colors",
        dragging ? "opacity-50" : "",
        isActive ? "bg-brand/10 text-brand" : "text-foreground/80 hover:bg-surface-muted hover:text-foreground",
      )}
    >
      <span
        aria-hidden
        title="拖拽排序（仅本类目内）"
        className="flex w-3.5 shrink-0 cursor-grab items-center justify-center text-muted opacity-40 group-hover:opacity-80"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <Link
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <item.icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-meta">{item.label}</span>
      </Link>
      <button
        type="button"
        aria-label={`取消固定 ${item.label}`}
        title="取消固定"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTogglePin();
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <PinOff aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** 二级浮层：展示该类目全部原始菜单，行尾带 Pin 图标。fixed 定位锚定按钮。 */
function Flyout({
  group,
  isActive,
  isPinned,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  anchor,
}: {
  group: NavigationGroup;
  isActive: (href: string) => boolean;
  isPinned: (id: string) => boolean;
  onTogglePin: (id: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  anchor: Anchor;
}) {
  // 限制浮层顶部不超出视口底部（浮层最大高度约 60vh + 头尾）。
  const maxTop = Math.max(8, typeof window !== "undefined" ? window.innerHeight - 460 : 8);
  const top = Math.min(Math.max(8, anchor.top), maxTop);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ left: anchor.left, top }}
      className="fixed z-dropdown w-72 rounded-xl border border-border bg-surface p-2 shadow-lg"
    >
      <div className="mb-1.5 flex items-center justify-between border-b border-border px-2 pb-2 pt-1">
        <div className="flex items-center gap-2">
          <group.icon aria-hidden className="h-4 w-4 text-brand" />
          <h3 className="text-section text-foreground">{group.label}</h3>
        </div>
        <span className="text-micro text-muted">{group.items.length} 项</span>
      </div>
      <div className="max-h-[60vh] space-y-0.5 overflow-y-auto pr-0.5">
        {group.items.map((item) => {
          const active = isActive(item.href);
          const pinned = isPinned(item.id);
          return (
            <div
              key={item.id}
              className={cn(
                "group flex min-h-9 items-center gap-2 rounded-md px-2 transition-colors",
                active ? "bg-brand/10 text-brand" : "text-foreground/80 hover:bg-surface-muted hover:text-foreground",
              )}
            >
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onMouseLeave}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <item.icon aria-hidden className="h-4 w-4 shrink-0" />
                <span className="truncate text-body">{item.label}</span>
              </Link>
              <button
                type="button"
                aria-label={pinned ? `取消固定 ${item.label}` : `固定到侧栏 ${item.label}`}
                title={pinned ? "取消固定" : "固定到侧栏"}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePin(item.id);
                }}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  pinned
                    ? "text-brand hover:bg-brand/10"
                    : "text-muted opacity-50 hover:bg-surface-muted hover:text-brand hover:opacity-100",
                )}
              >
                {pinned ? <PinOff aria-hidden className="h-4 w-4" /> : <Pin aria-hidden className="h-4 w-4" />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 border-t border-border px-2 pt-1.5 text-micro text-muted">点击图钉固定到侧栏，固定项可在本类目内拖动排序</p>
    </div>
  );
}

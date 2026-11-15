"use client";

import Link from "next/link";
import { hostPages, sellfoxNavOrder } from "@/lib/sellfox/host-pages";
import { replicaPages } from "@/lib/sellfox/replica-pages";

type NavItem = { href: string; label: string };

const extra: Record<string, string> = {
  "/sellfox": "数据总览",
  "/sellfox/sync": "同步",
};

/** 赛狐模块统一一级导航：6 个已交付页 + 7 个承接页 + 数据总览/同步，顺序按赛狐后台模块。 */
export function sellfoxNavItems(): NavItem[] {
  const all: NavItem[] = [
    ...replicaPages.map((page) => ({ href: page.href, label: page.title })),
    ...hostPages.map((page) => ({ href: page.href, label: page.title })),
  ];
  const byHref = new Map(all.map((item) => [item.href, item.label]));
  return sellfoxNavOrder
    .map((href) => ({ href, label: byHref.get(href) ?? extra[href] ?? href }))
    .filter((item) => Boolean(item.label));
}

export function SellfoxTabs({ current }: { current: string }) {
  return (
    <nav className="sf-tabs" aria-label="赛狐页面">
      {sellfoxNavItems().map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>{item.label}</Link>
      ))}
    </nav>
  );
}

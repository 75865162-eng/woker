"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { liliNavigation } from "@/lib/lili/routes";
import { useUI } from "@/lib/lili/ui";
import type { Locale } from "@/lib/lili/tx";

export function LiliNavigation({ locale, allowedPaths }: { locale: Locale; allowedPaths: string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState("");
  const toast = useUI((s) => s.toast);
  return <>
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
      <nav aria-label="Lili 模块" className="flex flex-1 flex-wrap gap-1">
        {liliNavigation.filter((item) => allowedPaths.includes(item.path)).map((item) => {
          const href = `/lili/v2/${item.path}`;
          const active = pathname === href || pathname?.startsWith(`${href}/`) || item.path === "start" && pathname === "/lili";
          return <Link key={item.path} href={href} aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm ${active ? "bg-surface-muted font-semibold text-brand" : "hover:bg-surface-muted"}`}>{item.title}</Link>;
        })}
      </nav>
      <button type="button" className="lili-btn-ghost" onClick={async () => {
        try {
          setError("");
          const response = await fetch("/api/lili/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: locale === "zh" ? "en" : "zh" }) });
          if (!response.ok) throw new Error("语言切换失败，请重试。");
          router.refresh();
        } catch (err) { setError(err instanceof Error ? err.message : "语言切换失败。"); }
      }}>{locale === "zh" ? "English" : "中文"}</button>
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {toast && <div role="status" className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-white">{toast}</div>}
  </>;
}

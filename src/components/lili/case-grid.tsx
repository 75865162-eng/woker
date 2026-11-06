"use client";

import Link from "next/link";
import { Archive, BadgeDollarSign, Copy, FileBarChart, Flame, Lightbulb, Package, Rocket, ScanSearch, Search, Undo2 } from "lucide-react";
import type { Locale } from "@/lib/lili/tx";
import { tx } from "@/lib/lili/tx";
import { copyText, useUI } from "@/lib/lili/ui";
import { useMemo, useState } from "react";

const ICONS = {
  reports: FileBarChart,
  ads: Flame,
  data: Search,
  listing: Rocket,
  market: ScanSearch,
  restock: Package,
  profit: BadgeDollarSign,
  returns: Undo2,
} as const;

export type CaseCard = {
  slug: string;
  category: string;
  index: number;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  summaryEn: string;
  promptZh: string;
  promptEn: string;
};

const CHIPS = [
  ["all", "全部", "All"],
  ["reports", "报表与分析", "Reports and analysis"],
  ["ads", "广告", "Ads"],
  ["market", "市场", "Market"],
  ["listing", "Listing", "Listing"],
  ["profit", "利润", "Profit"],
  ["restock", "补货", "Restock"],
  ["data", "数据", "Data"],
  ["returns", "退货", "Returns"],
] as const;

export function CaseGrid({ locale, items }: { locale: Locale; items: CaseCard[] }) {
  const [cat, setCat] = useState("all");
  const flash = useUI((s) => s.flash);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.category, (map.get(item.category) ?? 0) + 1);
    return map;
  }, [items]);
  const shown = cat === "all" ? items : items.filter((item) => item.category === cat);
  return (
    <div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {CHIPS.map(([id, zh, en]) => {
          const n = id === "all" ? items.length : counts.get(id) ?? 0;
          const active = cat === id;
          return (
            <button key={id} onClick={() => setCat(id)} className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${active ? "bg-brand text-white" : "bg-surface-muted text-foreground"}`}>
              {tx(locale, zh, en)} {n}
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">{tx(locale, "这个分类下没有模板。", "No templates in this filter.")}</p>}
      <div className="flex flex-wrap gap-3">
        {shown.map((item) => {
          const Icon = ICONS[item.category as keyof typeof ICONS] ?? Lightbulb;
          const sunset = item.slug === "sunset-sku";
          return (
            <article key={item.slug} className="lili-card flex w-full flex-col p-4 sm:w-[280px]">
              {sunset ? <Archive className="h-4 w-4 text-brand" /> : <Icon className="h-4 w-4 text-brand" />}
              <h3 className="mt-2 truncate text-[15px] font-semibold">{tx(locale, item.titleZh, item.titleEn)}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{tx(locale, item.summaryZh, item.summaryEn)}</p>
              <button
                className="lili-btn-orange mt-3 self-start "
                onClick={() => {
                  copyText(tx(locale, item.promptZh, item.promptEn));
                  flash(tx(locale, "已复制", "Copied"));
                }}
              >
                <Copy className="h-3.5 w-3.5" /> {tx(locale, "复制提示词", "Copy prompt")}
              </button>
              <Link href={`/lili/v2/cases/${item.slug}`} className="mt-2 text-xs text-brand">
                {tx(locale, "查看步骤", "View steps")}
              </Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronDown, Copy, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { Locale } from "@/lib/lili/tx";
import { tx } from "@/lib/lili/tx";
import { copyText, useUI } from "@/lib/lili/ui";

export type SkillCard = {
  slug: string;
  nameZh: string;
  nameEn: string;
  category: string;
  summaryZh: string;
  summaryEn: string;
  promptZh: string;
  promptEn: string;
  stepsZh: string[];
  stepsEn: string[];
  tools: string[];
  featured: boolean;
  isNew: boolean;
};

const PLAYBOOK = {
  exampleEn: "Using the 粒粒lili MCP skill ads-playbook-interview: Interview me and write down how I run my Amazon ads.",
  exampleZh: "使用粒粒lili技能 ads-playbook-interview：采访我，并写下我是怎么投亚马逊广告的。",
  keywords: ["grill me", "ads playbook", "ads playbook interview", "interview me", "document my ads process"],
};

function triggerKeywords(item: SkillCard, short: string) {
  if (item.slug === "ads-playbook-interview" || item.slug.endsWith("ads-playbook-interview")) return PLAYBOOK.keywords;
  const words = item.nameEn.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);
  const phrase = words.slice(0, 3).join(" ");
  return [...new Set([phrase, words[0], short.replace(/-/g, " "), `my ${words[0] || "workflow"}`])].filter(Boolean).slice(0, 5);
}

function exampleRequest(item: SkillCard, short: string, locale: Locale) {
  if (item.slug === "ads-playbook-interview" || item.slug.endsWith("ads-playbook-interview")) return tx(locale, PLAYBOOK.exampleZh, PLAYBOOK.exampleEn);
  const summary = tx(locale, item.summaryZh, item.summaryEn);
  return tx(
    locale,
    `使用粒粒lili MCP 技能 ${short}：${summary}`,
    `Using the 粒粒lili MCP skill ${short}: ${summary}`,
  );
}

const CHIPS = [
  ["all", "全部", "All"],
  ["featured", "精选", "Featured"],
  ["ads", "广告", "Ads"],
  ["market", "市场", "Market"],
  ["listing", "Listing", "Listing"],
  ["profit", "利润", "Profit"],
  ["keywords", "关键词", "Keywords"],
  ["restock", "补货", "Restock"],
  ["data", "数据", "Data"],
  ["compliance", "合规", "Compliance"],
  ["returns", "退货", "Returns"],
  ["orders", "订单", "Orders"],
] as const;

export function SkillGrid({ locale, items }: { locale: Locale; items: SkillCard[] }) {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const flash = useUI((s) => s.flash);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.category, (map.get(item.category) ?? 0) + 1);
    return map;
  }, [items]);
  const shown = items.filter((item) => {
    if (cat === "featured" && !item.featured) return false;
    if (cat !== "all" && cat !== "featured" && item.category !== cat) return false;
    const hay = `${item.nameZh} ${item.nameEn} ${item.slug} ${item.summaryZh} ${item.summaryEn}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tx(locale, "搜索技能", "Search skills")}
        className="lili-field mb-3 w-full"
      />
      <div className="mb-4 flex flex-wrap gap-2 pb-1">
        {CHIPS.map(([id, zh, en]) => {
          const n = id === "all" ? items.length : id === "featured" ? items.filter((s) => s.featured).length : counts.get(id) ?? 0;
          return (
            <button key={id} onClick={() => setCat(id)} className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${cat === id ? "bg-brand text-white" : "bg-surface-muted text-foreground"}`}>
              {tx(locale, zh, en)} {n}
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">{tx(locale, "没有匹配的技能。", "No skills match.")}</p>}
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((item) => {
          const short = item.slug.replace(/^(?:duobaoyu-|lili-)/, "");
          const label = short.length > 18 ? `${short.slice(0, 16)}…` : short;
          const expanded = open === item.slug;
          const example = exampleRequest(item, short, locale);
          const keywords = triggerKeywords(item, short);
          return (
            <article key={item.slug} className="lili-card flex flex-col p-4">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <h3 className="font-semibold leading-5">{tx(locale, item.nameZh, item.nameEn)}</h3>
                {item.isNew && <span className="ml-auto shrink-0 text-xs font-medium text-brand">{tx(locale, "新", "New")}</span>}
              </div>
              <p className={`mt-2 text-sm leading-5 text-muted ${expanded ? "" : "line-clamp-3"}`}>
                {tx(locale, item.summaryZh, item.summaryEn)}
              </p>
              {expanded && (
                <div className="mt-3 text-sm text-foreground">
                  <div className="text-xs text-muted">{tx(locale, "示例请求", "Example request")}</div>
                  <p className="mt-1 leading-6">{example}</p>
                  <div className="mt-3 text-xs text-muted">{tx(locale, "触发词", "Trigger keywords")}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {keywords.map((word) => (
                      <span key={word} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{word}</span>
                    ))}
                  </div>
                  <Link href={`/lili/v2/skills/${item.slug}`} className="mt-2 inline-block text-xs text-brand">
                    {tx(locale, "完整技能说明", "Full skill procedure")}
                  </Link>
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button className="flex min-w-0 items-center gap-1 text-xs text-muted" onClick={() => setOpen(expanded ? null : item.slug)}>
                  <span className="truncate">{label}</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${expanded ? "rotate-180" : ""}`} />
                  {expanded ? tx(locale, "收起", "Show less") : tx(locale, "展开", "Show more")}
                </button>
                <button
                  className="lili-btn-orange ml-auto "
                  onClick={() => {
                    copyText(tx(locale, item.promptZh, item.promptEn));
                    flash(tx(locale, "已复制", "Copied"));
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> {tx(locale, "复制提示词", "Copy prompt")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

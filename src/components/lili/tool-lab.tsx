"use client";

import Link from "next/link";
import { LiveTools } from "./live-tools";
import { useMemo, useState } from "react";
import type { Locale } from "@/lib/lili/tx";
import { tx } from "@/lib/lili/tx";

export type ToolCard = { name: string; description: string; category: string; readOnly: boolean; availability: "catalog" | "unmapped" };

export function ToolLab({ locale, tools }: { locale: Locale; tools: ToolCard[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const cats = useMemo(() => ["all", ...Array.from(new Set(tools.map((t) => t.category)))], [tools]);
  const shown = tools.filter((tool) => {
    if (cat !== "all" && tool.category !== cat) return false;
    const hay = `${tool.name} ${tool.description}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  return (
    <div>
      <LiveTools />
      <div className="mb-4 rounded-lg bg-surface-muted px-4 py-3 text-sm leading-6 text-muted">
        {tx(locale, "下方保留历史工具定义供参考；当前可调用工具、参数与授权以上方真实 MCP 目录为准。", "Historical tool definitions are retained below for reference. Use the live MCP registry above for callable tools, schemas and permissions.")}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="lili-field min-w-[220px] flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(locale, "搜索工具", "Search tools")} />
        <select className="lili-field" value={cat} onChange={(e) => setCat(e.target.value)}>
          {cats.map((item) => <option key={item} value={item}>{item === "all" ? tx(locale, `全部 ${tools.length}`, `All ${tools.length}`) : item}</option>)}
        </select>
      </div>
      <p className="mb-2 text-sm text-muted">{shown.length}</p>
      <div className="grid gap-2">
        {shown.map((tool) => (
          <Link key={tool.name} href={`/lili/v2/tools/${tool.name}`} className="lili-card flex items-start gap-3 px-4 py-3 hover:border-brand">
            <span className={`mt-0.5 rounded-full px-2 py-0.5 text-xs ${tool.readOnly ? "bg-emerald-50 text-emerald-700" : "bg-surface-muted text-brand"}`}>
              {tool.readOnly ? "read" : "write"}
            </span>
            <span>
              <span className="font-medium">{tool.name}</span>
              <span className="ml-2 text-xs text-muted">{tool.availability === "catalog" ? tx(locale, "目录查询可用", "Catalog available") : tx(locale, "未映射", "Not mapped")}</span>
              <span className="mt-0.5 block text-sm text-muted line-clamp-2">{tool.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

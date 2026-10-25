"use client";
import { useState } from "react";

export const tkShops = [
  { externalId: "124687", name: "TK店-US", marketplaceId: "ATVPDKIKX0DER" },
  { externalId: "124688", name: "TK店-CA", marketplaceId: "A2EUQ1WTGCTBG2" },
  { externalId: "426997", name: "TK店-MX", marketplaceId: "A1AM78C64UM0Y8" },
  { externalId: "245097", name: "TK店-BR", marketplaceId: "A2Q3Y263D00KWC" },
];
export function sellfoxHref(domain: "sales" | "inventory", workspaceId: string, shopExternalId = "124687", msku = "") {
  const params = new URLSearchParams({ domain, workspaceId, shopExternalId, dimension: "msku" });
  if (msku) { params.set("search", msku); params.set("searchType", "msku"); params.set("exactMatch", "1"); }
  return `/sellfox?${params}`;
}
export function SellfoxLinks({ workspaceId, shopExternalId, msku }: { workspaceId: string; shopExternalId?: string; msku?: string }) {
  const [shop, setShop] = useState("124687");
  return <nav aria-label="赛狐只读入口" className="flex flex-wrap items-center gap-3 text-xs">
    {!shopExternalId && <label>TK 快捷店铺 <select aria-label="TK 快捷店铺" value={shop} onChange={e => setShop(e.target.value)} className="h-8 border border-border bg-white px-2">{tkShops.map(item => <option key={item.externalId} value={item.externalId}>{item.name}</option>)}</select></label>}
    {(["sales", "inventory"] as const).map(domain => <a key={domain} className="text-brand hover:underline" href={sellfoxHref(domain, workspaceId, shopExternalId || shop, msku)}>打开赛狐{domain === "sales" ? "销量" : "FBA库存"}</a>)}
    <span className="text-muted">只读镜像 · 不启动同步</span>
  </nav>;
}

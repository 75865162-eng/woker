"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageThumb } from "@/components/ui/image-thumb";

export type ImageProduct = { sellerAccountId: string; marketplaceId: string; asin: string };

const cache = new Map<string, string>();
let inflight: Promise<void> | null = null;
const pending = new Set<string>();

function imgKey(p: ImageProduct) { return `${p.sellerAccountId}|${p.marketplaceId}|${p.asin}`; }
function scopeHeaders(): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  try { headers.set("x-workspace-id", JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}").workspaceId || "default"); } catch { headers.set("x-workspace-id", "default"); }
  return headers;
}

/** Fetch a batch of SP-API catalog main-image URLs. Non-critical: silently degrades to no images. */
export function useMainImages(products: ImageProduct[]): Map<string, string> {
  const [renderTick, force] = useState(0);
  const signature = useMemo(() => {
    const keys = [...new Set(products.filter(p => p && p.sellerAccountId && p.marketplaceId && /^[A-Z0-9]{10}$/.test(p.asin || "")).map(imgKey))].sort();
    return keys.join("~");
  }, [products]);
  const lastSig = useRef("");

  useEffect(() => {
    if (!signature || signature === lastSig.current) return;
    lastSig.current = signature;
    const keys = signature.split("~").filter(Boolean);
    const missing = keys.filter(k => !cache.has(k));
    if (!missing.length) { if (cache.size) force(v => v + 1); return; }

    for (const k of missing) pending.add(k);
    const batches: ImageProduct[][] = [];
    let current: ImageProduct[] = [];
    for (const k of missing) {
      const [sellerAccountId, marketplaceId, asin] = k.split("|");
      current.push({ sellerAccountId, marketplaceId, asin });
      if (current.length === 300) { batches.push(current); current = []; }
    }
    if (current.length) batches.push(current);

    const load = async () => {
      for (const batch of batches) {
        try {
          const res = await fetch("/api/amazon/main-images", { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ products: batch }), cache: "no-store" });
          if (!res.ok) continue;
          const data = (await res.json()) as { images?: Record<string, string> };
          for (const [key, url] of Object.entries(data.images ?? {})) if (url) { cache.set(key, url); pending.delete(key); }
        } catch { /* keep pending keys so a later render can retry */ }
      }
      force(v => v + 1);
    };

    if (inflight) { void inflight.then(load); } else { inflight = load().finally(() => { inflight = null; }); }
  }, [signature]);

  const result = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) { const url = cache.get(imgKey(p)); if (url) map.set(imgKey(p), url); }
    return map;
    // renderTick makes the memo re-evaluate after images arrive in the cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, signature, renderTick]);
  return result;
}

export function AsinThumb({ sellerAccountId, marketplaceId, asin, images, className = "h-14 w-14" }: {
  sellerAccountId: string; marketplaceId: string; asin: string; images: Map<string, string>; className?: string;
}) {
  const src = images.get(imgKey({ sellerAccountId, marketplaceId, asin }));
  return <ImageThumb src={src} alt={asin || "商品主图"} fallback={asin || "—"} className={className} referrerPolicy="no-referrer" />;
}

// ---- Loose mode: pages whose rows expose only an ASIN ----
const asinCache = new Map<string, string>();
let asinInflight: Promise<void> | null = null;

/** Resolve main-image URLs for a list of ASINs within the caller's visible catalog sources. */
export function useMainImagesByAsin(asins: string[]): Map<string, string> {
  const [tick, setTick] = useState(0);
  const signature = useMemo(() => [...new Set(asins.filter(a => /^[A-Z0-9]{10}$/.test(a || "")))].sort().join("~"), [asins]);
  const lastSig = useRef("");

  useEffect(() => {
    if (!signature || signature === lastSig.current) return;
    lastSig.current = signature;
    const keys = signature.split("~").filter(Boolean);
    if (!keys.some(k => !asinCache.has(k))) { if (asinCache.size) setTick(v => v + 1); return; }
    const batches: string[][] = [];
    let current: string[] = [];
    for (const k of keys) { current.push(k); if (current.length === 300) { batches.push(current); current = []; } }
    if (current.length) batches.push(current);
    const load = async () => {
      for (const batch of batches) {
        try {
          const res = await fetch("/api/amazon/main-images", { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ asins: batch }), cache: "no-store" });
          if (!res.ok) continue;
          const data = (await res.json()) as { images?: Record<string, string> };
          for (const [asin, url] of Object.entries(data.images ?? {})) if (url) asinCache.set(asin, url);
        } catch { /* retry on a later render */ }
      }
      setTick(v => v + 1);
    };
    if (asinInflight) void asinInflight.then(load);
    else asinInflight = load().finally(() => { asinInflight = null; });
  }, [signature]);

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const a of asins) { const url = asinCache.get(a); if (url) map.set(a, url); }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asins, signature, tick]);
}

export function AsinThumbByAsin({ asin, images, className = "h-14 w-14" }: { asin: string; images: Map<string, string>; className?: string }) {
  return <ImageThumb src={images.get(asin)} alt={asin || "商品主图"} fallback={asin || "—"} className={className} referrerPolicy="no-referrer" />;
}

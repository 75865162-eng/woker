"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SignedUrlEntry = { url: string; expiresAt: number };
type SignedUrlResponse = { urls?: Array<{ fileId: string; url: string }>; expiresAt?: string; error?: string };

const urlCache = new Map<string, SignedUrlEntry>();
const refreshSkewMs = 30_000;
let queuedFileIds = new Set<string>();
let queuedRequests: Array<{ fileIds: string[]; resolve: (urls: Map<string, string>) => void; reject: (error: unknown) => void }> = [];
let batchScheduled = false;

function getScopeHeaders() {
  try {
    const raw = window.localStorage.getItem("amazon_bulk_ad_workspace_scope");
    const scope = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return {
      "Content-Type": "application/json",
      ...(typeof scope.workspaceId === "string" && scope.workspaceId ? { "x-workspace-id": scope.workspaceId } : {}),
      ...(typeof scope.accountId === "string" && scope.accountId ? { "x-account-id": scope.accountId } : {}),
      ...(typeof scope.marketplace === "string" && scope.marketplace ? { "x-marketplace": scope.marketplace } : {}),
    };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

export async function refreshProductImageUrls(fileIds: string[]) {
  const uniqueIds = [...new Set(fileIds.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, string>();

  const response = await fetch("/api/products/image-urls", {
    method: "POST",
    headers: getScopeHeaders(),
    body: JSON.stringify({ fileIds: uniqueIds }),
  });
  const data = await response.json().catch(() => ({})) as SignedUrlResponse;
  if (!response.ok || !data.urls || !data.expiresAt) {
    throw new Error(data.error || "商品图片链接签发失败。");
  }

  const expiresAt = new Date(data.expiresAt).getTime();
  const result = new Map<string, string>();
  for (const item of data.urls) {
    urlCache.set(item.fileId, { url: item.url, expiresAt });
    result.set(item.fileId, item.url);
  }
  return result;
}

function queueProductImageUrlRefresh(fileIds: string[]) {
  const uniqueIds = [...new Set(fileIds.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) return Promise.resolve(new Map<string, string>());

  return new Promise<Map<string, string>>((resolve, reject) => {
    uniqueIds.forEach((id) => queuedFileIds.add(id));
    queuedRequests.push({ fileIds: uniqueIds, resolve, reject });
    if (batchScheduled) return;
    batchScheduled = true;
    queueMicrotask(async () => {
      const requests = queuedRequests;
      const ids = [...queuedFileIds];
      queuedRequests = [];
      queuedFileIds = new Set();
      batchScheduled = false;
      try {
        const urls = await refreshProductImageUrls(ids);
        for (const request of requests) {
          request.resolve(new Map(request.fileIds.flatMap((id) => urls.has(id) ? [[id, urls.get(id)!] as const] : [])));
        }
      } catch (error) {
        requests.forEach((request) => request.reject(error));
      }
    });
  });
}

export function useProductImageUrls(fileIds: Array<string | undefined>) {
  const fileIdsKey = fileIds.filter((id): id is string => Boolean(id?.trim())).map((id) => id.trim()).join("|");
  const normalizedIds = useMemo(() => fileIdsKey ? [...new Set(fileIdsKey.split("|"))] : [], [fileIdsKey]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const refresh = useCallback(async (ids = normalizedIds) => {
    const next = await queueProductImageUrlRefresh(ids);
    setUrls((current) => ({ ...current, ...Object.fromEntries(next) }));
    setError("");
  }, [normalizedIds]);

  useEffect(() => {
    const now = Date.now();
    const cached = normalizedIds.filter((id) => {
      const entry = urlCache.get(id);
      return entry && entry.expiresAt > now + refreshSkewMs;
    });
    if (cached.length) {
      setUrls((current) => ({ ...current, ...Object.fromEntries(cached.map((id) => [id, urlCache.get(id)!.url])) }));
    }
    const missing = normalizedIds.filter((id) => !cached.includes(id));
    if (missing.length) void refresh(missing).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "商品图片链接签发失败。");
    });
  }, [normalizedIds, refresh]);

  return { urls, refresh, error };
}

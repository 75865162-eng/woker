import { NextResponse } from "next/server";
import type { VitalName } from "@/lib/observability/web-vitals";

export const runtime = "nodejs";

const VALID_NAMES = new Set<VitalName>(["FCP", "LCP", "INP", "CLS", "TTFB"]);
const MAX_PAGE_LEN = 200;
const MAX_BODY = 4096;
// best-effort 防滥用：进程内滑动窗口（单实例部署），不记录 IP 到日志。
const WINDOW_MS = 60_000;
const LIMIT = 120;
const hits = new Map<string, number[]>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

function allowed(key: string, now: number): boolean {
  const arr = hits.get(key) ?? [];
  while (arr.length && now - arr[0] > WINDOW_MS) arr.shift();
  if (arr.length >= LIMIT) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

/** 接收 RUM Web Vitals 上报。只校验结构，不落业务数据；best-effort 输出结构化日志。 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
    const rec = body as { name?: unknown; value?: unknown; page?: unknown };
    if (typeof rec.name !== "string" || !VALID_NAMES.has(rec.name as VitalName)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof rec.value !== "number" || !Number.isFinite(rec.value) || rec.value < 0 || rec.value > 600_000) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof rec.page !== "string" || rec.page.length > MAX_PAGE_LEN) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!allowed(clientKey(request), Date.now())) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }
    try {
      console.info(JSON.stringify({
        scope: "rum.vital", name: rec.name, value: rec.value,
        page: rec.page.slice(0, MAX_PAGE_LEN), at: new Date().toISOString(),
      }));
    } catch { /* fail-silent */ }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

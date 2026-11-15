import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

// key 约定："table-columns:<tableId>" 等 <namespace>:<id> 形式，后续 UI 偏好复用同一张表
const KEY_PATTERN = /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]{1,120}$/;
const VALUE_MAX_BYTES = 8 * 1024;
const WIDTH_MIN = 48;
const WIDTH_MAX = 800;

function sanitizeValue(value: unknown): { widths: Record<string, number> } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const widths = (value as { widths?: unknown }).widths;
  if (typeof widths !== "object" || widths === null || Array.isArray(widths)) return null;

  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(widths as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(key)) return null;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    result[key] = Math.round(Math.min(Math.max(raw, WIDTH_MIN), WIDTH_MAX));
  }

  if (JSON.stringify(result).length > VALUE_MAX_BYTES) return null;
  return { widths: result };
}

function normalizeKey(raw: string): string | null {
  const key = decodeURIComponent(raw);
  return KEY_PATTERN.test(key) ? key : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!process.env.DATABASE_URL) return NextResponse.json({ value: null });

    const { key: rawKey } = await params;
    const key = normalizeKey(rawKey);
    if (!key) return NextResponse.json({ error: "Invalid preference key." }, { status: 400 });

    const record = await prisma.userPreference.findUnique({
      where: { userId_key: { userId: user.id, key } },
      select: { value: true },
    });

    return NextResponse.json({ value: record?.value ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "偏好读取失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!process.env.DATABASE_URL) return NextResponse.json({ error: "偏好数据库未配置，当前修改未持久化。", persisted: false }, { status: 503 });

    const { key: rawKey } = await params;
    const key = normalizeKey(rawKey);
    if (!key) return NextResponse.json({ error: "Invalid preference key." }, { status: 400 });

    const body = (await request.json().catch(() => null)) as unknown;
    const value = sanitizeValue(body);
    if (!value) return NextResponse.json({ error: "Invalid preference value." }, { status: 400 });

    await prisma.userPreference.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { userId: user.id, key, value },
      update: { value },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, value });
  } catch (error) {
    const message = error instanceof Error ? error.message : "偏好保存失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

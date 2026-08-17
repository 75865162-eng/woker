import { NextResponse } from "next/server";
import { destroyCurrentSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  await destroyCurrentSession(response, request);

  return response;
}

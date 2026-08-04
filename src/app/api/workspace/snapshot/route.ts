import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const record = await prisma.workspaceSnapshot.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!record) {
      return NextResponse.json({ snapshot: null });
    }

    return NextResponse.json({
      version: record.version,
      savedAt: record.savedAt.toISOString(),
      snapshot: record.snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspace snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as { version?: unknown; snapshot?: unknown };

    if (!isJsonObject(body.snapshot)) {
      return NextResponse.json({ error: "Invalid workspace snapshot payload." }, { status: 400 });
    }

    const version = Number(body.version) || 1;
    const savedAt = new Date();

    await prisma.workspaceSnapshot.upsert({
      where: {
        userId: user.id,
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        version,
        savedAt,
        snapshot: body.snapshot as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        version,
        savedAt,
        snapshot: body.snapshot as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ version, savedAt: savedAt.toISOString(), snapshot: body.snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save workspace snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await prisma.workspaceSnapshot.deleteMany({
      where: {
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete workspace snapshot.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

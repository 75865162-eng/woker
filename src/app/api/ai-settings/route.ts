import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  normalizeAiSettings,
  type AiModelSettings,
  type SavedAiModelProfile,
} from "@/lib/ai-settings";

export const runtime = "nodejs";

type AiSettingsPayload = {
  settings?: unknown;
  profiles?: unknown;
  activeProfileId?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseSettings(value: unknown): AiModelSettings {
  if (!isRecord(value)) {
    throw new Error("Invalid AI settings payload.");
  }

  return normalizeAiSettings(value as Partial<AiModelSettings>);
}

function parseProfiles(value: unknown): SavedAiModelProfile[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isRecord)
    .map((profile) => {
      const settings = parseSettings(profile.settings);
      const now = new Date().toISOString();

      return {
        id: typeof profile.id === "string" && profile.id ? profile.id : `${settings.provider}-${settings.model}-${Date.now()}`,
        name: typeof profile.name === "string" && profile.name ? profile.name : `${settings.provider} · ${settings.model}`,
        createdAt: typeof profile.createdAt === "string" && profile.createdAt ? profile.createdAt : now,
        updatedAt: typeof profile.updatedAt === "string" && profile.updatedAt ? profile.updatedAt : now,
        settings,
      } satisfies SavedAiModelProfile;
    })
    .slice(0, 20);
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const record = await prisma.aiModelSetting.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!record) {
      return NextResponse.json({ settings: null, profiles: [], activeProfileId: "" });
    }

    return NextResponse.json({
      settings: normalizeAiSettings(record.settings as Partial<AiModelSettings>),
      profiles: parseProfiles(record.profiles),
      activeProfileId: record.activeProfileId ?? "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load AI settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as AiSettingsPayload;
    const settings = parseSettings(body.settings);
    const profiles = parseProfiles(body.profiles);
    const activeProfileId = typeof body.activeProfileId === "string" ? body.activeProfileId : "";

    await prisma.aiModelSetting.upsert({
      where: {
        userId: user.id,
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        activeProfileId,
        settings: settings as unknown as Prisma.InputJsonValue,
        profiles: profiles as unknown as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        activeProfileId,
        settings: settings as unknown as Prisma.InputJsonValue,
        profiles: profiles as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ settings, profiles, activeProfileId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save AI settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

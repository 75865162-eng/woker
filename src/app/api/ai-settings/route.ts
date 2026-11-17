import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { ensureCurrentUserRecord } from "@/lib/auth/ensure-user-record";
import { prisma } from "@/lib/db/prisma";
import {
  createAiImageProfileName,
  createAiProfileName,
  normalizeAiImageSettings,
  normalizeAiSettings,
  normalizeSavedAiModelProfiles,
  type AiModelSettings,
  type AiSettingsBundle,
  type SavedAiModelProfile,
} from "@/lib/ai-settings";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { resolveAiSettings } from "@/lib/server/ai-runtime";
import {
  decryptAiBundleFromStorage,
  decryptAiProfilesFromStorage,
  encryptAiBundleForStorage,
  encryptAiProfilesForStorage,
} from "@/lib/server/ai-settings-store";
import { redactForLog } from "@/lib/server/ai-error";

export const runtime = "nodejs";

type AiSettingsPayload = {
  settings?: unknown;
  imageSettings?: unknown;
  profiles?: unknown;
  activeProfileId?: unknown;
  workspaceId?: unknown;
  accountId?: unknown;
  marketplace?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function recordVersionSafely(input: Parameters<typeof recordDataChangeVersion>[0]) {
  try {
    await recordDataChangeVersion(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record AI settings version.";
    console.warn(message);
  }
}

function parsePartialSettings(value: unknown, fallback: AiModelSettings, kind: "text" | "image") {
  if (value === undefined) return fallback;
  if (value === null) return kind === "image" ? normalizeAiImageSettings(null) : normalizeAiSettings(null);

  if (!isRecord(value)) {
    throw new Error("Invalid AI settings payload.");
  }

  return kind === "image"
    ? normalizeAiImageSettings(value as Partial<AiModelSettings>)
    : normalizeAiSettings(value as Partial<AiModelSettings>);
}

function pairProfiles(
  settings: AiSettingsBundle,
  profiles: SavedAiModelProfile[],
): SavedAiModelProfile[] {
  const systemProfile = profiles.find((profile) => profile.kind === "system");
  const imageProfile = profiles.find((profile) => profile.kind === "image");

  if (systemProfile && imageProfile) return profiles;

  if (systemProfile) {
    const bundleId = systemProfile.bundleId || systemProfile.id;
    const systemName = systemProfile.name || createAiProfileName(settings.text);

    return [
      { ...systemProfile, bundleId, name: systemName },
      {
        id: `${bundleId}::image`,
        bundleId,
        kind: "image",
        name: createAiImageProfileName(systemName),
        createdAt: systemProfile.createdAt,
        updatedAt: systemProfile.updatedAt,
        settings: settings.image,
      },
    ];
  }

  const fallbackName = createAiProfileName(settings.text);
  const bundleId = `${settings.text.provider}-${settings.text.model}-${Date.now()}`;

  return [
    {
      id: bundleId,
      bundleId,
      kind: "system",
      name: fallbackName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: settings.text,
    },
    {
      id: `${bundleId}::image`,
      bundleId,
      kind: "image",
      name: createAiImageProfileName(fallbackName),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: settings.image,
    },
  ];
}

function createDefaultSettingsBundle(): AiSettingsBundle {
  return {
    text: resolveAiSettings(undefined, "text"),
    image: resolveAiSettings(undefined, "image"),
  };
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const scope = workspaceScopeFromRequest(request);
    const record = await prisma.aiModelSetting.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });

    if (!record) {
      const defaults = createDefaultSettingsBundle();
      const nextProfiles = pairProfiles(defaults, []);
      const activeProfileId = nextProfiles.find((profile) => profile.kind === "system")?.id || "";

      await ensureCurrentUserRecord(user);
      const cryptoScope = { organizationId: user.organizationId, workspaceId: scope.workspaceId };
      await prisma.aiModelSetting.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          activeProfileId,
          settings: encryptAiBundleForStorage(defaults, cryptoScope) as unknown as Prisma.InputJsonValue,
          profiles: encryptAiProfilesForStorage(nextProfiles, cryptoScope) as unknown as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json({
        settings: defaults.text,
        imageSettings: defaults.image,
        profiles: nextProfiles,
        activeProfileId,
      });
    }

    const cryptoScope = { organizationId: user.organizationId, workspaceId: scope.workspaceId };
    const normalized = decryptAiBundleFromStorage(record.settings, cryptoScope);
    const nextProfiles = pairProfiles(normalized, decryptAiProfilesFromStorage(record.profiles, cryptoScope));

    return NextResponse.json({
      settings: normalized.text,
      imageSettings: normalized.image,
      profiles: nextProfiles,
      activeProfileId: record.activeProfileId ?? "",
    });
  } catch (error) {
    console.warn("[ai-settings] load failed:", error instanceof Error ? redactForLog(error.message) : "unknown error");
    return NextResponse.json({ error: "加载 AI 配置失败，请稍后重试。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const body = (await request.json()) as AiSettingsPayload;
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const existingRecord = await prisma.aiModelSetting.findUnique({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
    });
    const cryptoScope = { organizationId: user.organizationId, workspaceId: scope.workspaceId };
    const existingSettings = existingRecord
      ? decryptAiBundleFromStorage(existingRecord.settings, cryptoScope)
      : createDefaultSettingsBundle();
    const settings = {
      text: parsePartialSettings(body.settings, existingSettings.text, "text"),
      image: parsePartialSettings(body.imageSettings, existingSettings.image, "image"),
    } satisfies AiSettingsBundle;
    const submittedProfiles =
      body.profiles === undefined
        ? decryptAiProfilesFromStorage(existingRecord?.profiles, cryptoScope)
        : normalizeSavedAiModelProfiles(body.profiles);
    const nextProfiles = pairProfiles(settings, submittedProfiles);
    const activeProfileId = typeof body.activeProfileId === "string" ? body.activeProfileId : "";

    await ensureCurrentUserRecord(user);

    // 落库与版本记录均存密文；仅 HTTP 响应返回明文给配置所属用户本人。
    const storedSettings = encryptAiBundleForStorage(settings, cryptoScope);
    const storedProfiles = encryptAiProfilesForStorage(nextProfiles, cryptoScope);

    await prisma.aiModelSetting.upsert({
      where: {
        organizationId_workspaceId_userId: {
          organizationId: user.organizationId,
          workspaceId: scope.workspaceId,
          userId: user.id,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        activeProfileId,
        settings: storedSettings as unknown as Prisma.InputJsonValue,
        profiles: storedProfiles as unknown as Prisma.InputJsonValue,
      },
      update: {
        organizationId: user.organizationId,
        accountId: scope.accountId,
        marketplace: scope.marketplace,
        activeProfileId,
        settings: storedSettings as unknown as Prisma.InputJsonValue,
        profiles: storedProfiles as unknown as Prisma.InputJsonValue,
      },
    });
    await recordVersionSafely({
      user,
      entityType: "ai_model_setting",
      entityId: `${scope.workspaceId}:${user.id}`,
      action: "ai_model_setting_save",
      summary: activeProfileId || createAiProfileName(settings.text),
      payload: {
        settings: storedSettings.text,
        imageSettings: storedSettings.image,
        profiles: storedProfiles,
        activeProfileId,
      } as unknown as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ settings: settings.text, imageSettings: settings.image, profiles: nextProfiles, activeProfileId });
  } catch (error) {
    console.warn("[ai-settings] save failed:", error instanceof Error ? redactForLog(error.message) : "unknown error");
    return NextResponse.json({ error: "保存 AI 配置失败，请检查输入或稍后重试。" }, { status: 500 });
  }
}

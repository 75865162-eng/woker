import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordDataChangeVersion } from "@/lib/audit/versioning";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { ensureCurrentUserRecord } from "@/lib/auth/ensure-user-record";
import {
  getSellerSpriteMcpSettings,
  getPublicSellerSpriteMcpSettings,
  saveSellerSpriteMcpSettings,
} from "@/lib/server/integration-settings";
import {
  normalizeSellerSpriteMcpSettings,
  sellerSpriteIntegrationProvider,
  toPublicSellerSpriteMcpSettings,
  validateSellerSpriteMcpSettings,
  type SellerSpriteMcpSettings,
} from "@/lib/integrations/sellersprite";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type SellerSpritePayload = {
  settings?: unknown;
  workspaceId?: unknown;
  accountId?: unknown;
  marketplace?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseSubmittedSettings(value: unknown): Partial<SellerSpriteMcpSettings> {
  if (!isRecord(value)) return {};

  return {
    enabled: Boolean(value.enabled),
    serverUrl: typeof value.serverUrl === "string" ? value.serverUrl : undefined,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
    marketplace: typeof value.marketplace === "string" ? value.marketplace : undefined,
    timeoutSeconds: value.timeoutSeconds === undefined ? undefined : Number(value.timeoutSeconds),
    protocolVersion: typeof value.protocolVersion === "string" ? value.protocolVersion : undefined,
  };
}

async function recordVersionSafely(input: Parameters<typeof recordDataChangeVersion>[0]) {
  try {
    await recordDataChangeVersion(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record SellerSprite MCP settings version.";
    console.warn(message);
  }
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const scope = workspaceScopeFromRequest(request);
    const settings = await getPublicSellerSpriteMcpSettings(permission.user, scope);

    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SellerSprite MCP 配置读取失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "edit", request);

    if (!permission.ok) {
      return permission.response;
    }

    const body = (await request.json().catch(() => ({}))) as SellerSpritePayload;
    const scope = workspaceScopeFromRequest(request, body as Record<string, unknown>);
    const submitted = parseSubmittedSettings(body.settings);
    const existing = await getSellerSpriteMcpSettings(permission.user, scope);
    const candidate = normalizeSellerSpriteMcpSettings(
      {
        ...existing,
        ...submitted,
        apiKey: submitted.apiKey?.trim() ? submitted.apiKey : existing.apiKey,
      },
      existing,
    );
    const validationError = validateSellerSpriteMcpSettings(candidate);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    await ensureCurrentUserRecord(permission.user);

    const saved = await saveSellerSpriteMcpSettings(permission.user, scope, submitted);
    const publicSettings = toPublicSellerSpriteMcpSettings(saved);

    await recordVersionSafely({
      user: permission.user,
      entityType: "external_integration_setting",
      entityId: `${scope.workspaceId}:${permission.user.id}:${sellerSpriteIntegrationProvider}`,
      action: "external_integration_setting_save",
      summary: "SellerSprite MCP",
      payload: {
        provider: sellerSpriteIntegrationProvider,
        settings: publicSettings,
      } as unknown as Prisma.InputJsonValue,
      scope,
    });

    return NextResponse.json({ settings: publicSettings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SellerSprite MCP 配置保存失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("settings", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const body = (await request.json().catch(() => ({}))) as SellerSpritePayload;
    const submitted = parseSubmittedSettings(body.settings);
    const candidate = normalizeSellerSpriteMcpSettings(submitted);
    const validationError = validateSellerSpriteMcpSettings(candidate);
    const publicSettings = toPublicSellerSpriteMcpSettings(candidate);

    if (validationError) {
      return NextResponse.json({
        ok: false,
        status: "missing_credentials",
        settings: publicSettings,
        message: validationError,
      });
    }

    return NextResponse.json({
      ok: true,
      status: "configured",
      settings: publicSettings,
      message: "SellerSprite MCP 配置格式已符合官方要求，可以继续保存并在后续真实接入时直接使用。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SellerSprite MCP 连接测试失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

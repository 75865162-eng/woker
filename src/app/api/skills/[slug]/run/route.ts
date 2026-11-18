import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest, WorkspaceScopeError } from "@/lib/workspace/scope";
import { prisma } from "@/lib/db/prisma";
import { resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import { loadSkillBody } from "@/lib/skill-engine/config";
import { SKILL_MODULE_ID, SKILL_RUN_ACTION, type SkillRunEvent, type DataSource } from "@/lib/skill-engine/types";
import { runSkill } from "@/lib/skill-engine/runner";
import { exportReport } from "@/lib/skill-engine/exporter";
import { putReport } from "@/lib/skill-engine/report-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUTS = 20;
const MAX_INPUT_VALUE = 2000;

function sse(event: SkillRunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function parseInputs(raw: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return output;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(output).length >= MAX_INPUTS) break;
    if (typeof value !== "string") continue;
    output[key.slice(0, 60)] = value.slice(0, MAX_INPUT_VALUE);
  }
  return output;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const permission = await requireApiPermission(SKILL_MODULE_ID, SKILL_RUN_ACTION, request);
    if (!permission.ok) return permission.response;
    const { user } = permission;
    const { slug } = await context.params;

    const loaded = await loadSkillBody(slug);
    if (!loaded) return NextResponse.json({ error: "未找到该 Skill。" }, { status: 404 });

    let body: { inputs?: unknown };
    try {
      body = (await request.json()) as { inputs?: unknown };
    } catch {
      return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
    }
    const inputs = parseInputs(body.inputs);

    const scope = workspaceScopeFromRequest(request);
    if (process.env.DATABASE_URL && !(await assertWorkspaceAccess(user.organizationId, scope.workspaceId, user.id, undefined, request))) {
      return NextResponse.json({ error: "无权访问该工作区。" }, { status: 403 });
    }

    // 数据源摘要：仅当前组织/工作区，只读字段，用于判断数据可用性。
    let sources: DataSource[] = [];
    if (process.env.DATABASE_URL) {
      const rows = await prisma.amazonSyncDataSource.findMany({
        where: { organizationId: user.organizationId, workspaceId: scope.workspaceId },
        select: {
          id: true, resource: true, sellerAccountId: true, marketplaceId: true,
          activeRunId: true, lastSuccessAt: true, rowCount: true,
          publishedRun: {
            select: { status: true, executionVersion: true, resource: true, sourceId: true, finishedAt: true, stage: true },
          },
        },
        take: 201,
      });
      sources = rows.slice(0, 200).map((row) => ({
        ...row,
        freshnessMinutes: 1440,
        publishedRun: row.publishedRun,
      }));
    }

    const aiSettings = await resolveUserAiTextSettings(
      { organizationId: user.organizationId, id: user.id },
      scope,
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (event: SkillRunEvent) => controller.enqueue(encoder.encode(sse(event)));
        try {
          const generator = runSkill(
            {
              view: loaded.view,
              body: loaded.body,
              inputs,
              aiSettings,
              sources,
              actor: user.id,
            },
            {
              persistReport: async (report, fileName) => {
                const bytes = await exportReport(loaded.view.exportFormat, report, fileName);
                return putReport({
                  bytes,
                  fileName,
                  format: loaded.view.exportFormat,
                  organizationId: user.organizationId,
                  userId: user.id,
                });
              },
            },
          );
          for await (const event of generator) push(event);
        } catch (error) {
          push({
            type: "error",
            code: "RUN_FAILED",
            message: error instanceof Error ? error.message : "运行失败，请稍后重试。",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceScopeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "运行请求失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

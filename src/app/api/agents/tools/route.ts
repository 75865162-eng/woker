import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { defaultToolDefinitions } from "@/lib/agent-platform/defaults";
import { toAgentToolDefinition } from "@/lib/agent-platform/catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("agents", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ tools: defaultToolDefinitions });
    }

    const toolRecords = await prisma.agentTool.findMany({
      where: {
        organizationId: user.organizationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json({
      tools: [...defaultToolDefinitions, ...toolRecords.map(toAgentToolDefinition)],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tools." },
      { status: 500 },
    );
  }
}


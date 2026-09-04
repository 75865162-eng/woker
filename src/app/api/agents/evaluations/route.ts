import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { marketEvaluationCases } from "@/lib/agent-platform/market";
import { listingEvaluationCases } from "@/lib/agent-platform/listing";
import { productEvaluationCases } from "@/lib/agent-platform/product";
import { supplierEvaluationCases } from "@/lib/agent-platform/supplier";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("agents", "view", request);

    if (!permission.ok) {
      return permission.response;
    }

    const { user } = permission;

    const agentId = new URL(request.url).searchParams.get("agentId");
    const defaultCases = [...marketEvaluationCases, ...listingEvaluationCases, ...productEvaluationCases, ...supplierEvaluationCases];

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        cases: filterEvaluationCases(defaultCases, agentId),
        runs: [],
      });
    }

    const [cases, runs] = await Promise.all([
      prisma.agentEvaluationCase.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 50,
      }),
      prisma.agentEvaluationRun.findMany({
        where: {
          organizationId: user.organizationId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      }),
    ]);

    return NextResponse.json({
      cases: filterEvaluationCases(cases.length ? cases : defaultCases, agentId),
      runs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load evaluations." },
      { status: 500 },
    );
  }
}

function filterEvaluationCases(cases: unknown[], agentId: string | null) {
  if (!agentId) return cases;

  return cases.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return record.agentDefinitionId === agentId || !record.agentDefinitionId;
  });
}

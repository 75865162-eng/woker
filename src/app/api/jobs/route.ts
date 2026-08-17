import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

function clampPageSize(value: string | null) {
  const pageSize = Number(value) || 50;
  return Math.min(Math.max(pageSize, 1), 200);
}

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission(request, "workspace", "view");

    if (!permission.ok) {
      return permission.response;
    }
    const { user } = permission;

    const url = new URL(request.url);
    const scope = workspaceScopeFromRequest(request);
    const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
    const pageSize = clampPageSize(url.searchParams.get("pageSize"));
    const status = url.searchParams.get("status")?.trim();
    const search = url.searchParams.get("search")?.trim();
    const where: Prisma.ImportJobWhereInput = {
      organizationId: user.organizationId,
      workspaceId: scope.workspaceId,
      ...(scope.accountId ? { accountId: scope.accountId } : {}),
      ...(scope.marketplace ? { marketplace: scope.marketplace } : {}),
      ...(status ? { status: status as Prisma.EnumImportJobStatusFilter["equals"] } : {}),
      ...(search
        ? {
            file: {
              originalName: { contains: search, mode: "insensitive" },
            },
          }
        : {}),
    };
    const [total, jobs] = await Promise.all([
      prisma.importJob.count({ where }),
      prisma.importJob.findMany({
        where,
        include: { file: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      jobs,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load jobs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

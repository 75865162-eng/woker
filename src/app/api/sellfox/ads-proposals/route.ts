import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { generateAdsProposals } from "@/lib/sellfox/ads-proposal";

export const runtime = "nodejs";

const PROPOSAL_SELECT = {
  id: true, storeId: true, asin: true, msku: true, kind: true, action: true, entityType: true, externalId: true,
  label: true, proposed: true, basis: true, expectedImpact: true, status: true, reviewedBy: true, decisionReason: true,
  changeDraftId: true, executedAt: true, executionNote: true, createdAt: true,
  store: { select: { name: true, marketplace: true, country: true } },
} as const;

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "view", request);
    if (!permission.ok) return permission.response;
    const organizationId = permission.user.organizationId;
    const workspaceId = workspaceScopeFromRequest(request).workspaceId;
    const status = new URL(request.url).searchParams.get("status");
    const proposals = await prisma.sellfoxAdsProposal.findMany({
      where: { organizationId, workspaceId, ...(status ? { status } : {}) },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: PROPOSAL_SELECT,
    });
    const counts = await prisma.sellfoxAdsProposal.groupBy({ by: ["status"], where: { organizationId, workspaceId }, _count: { _all: true } });
    return NextResponse.json({
      proposals: proposals.map(p => ({ ...p, createdAt: p.createdAt.toISOString(), executedAt: p.executedAt?.toISOString() ?? null })),
      counts: Object.fromEntries(counts.map(c => [c.status, c._count._all])),
      writeExecution: { enabled: process.env.AMAZON_ADS_WRITE_ENABLED === "1", note: "真实写回需先绑定 Amazon Ads 授权并完成小额契约验证。" },
    });
  } catch {
    return NextResponse.json({ error: "读取广告优化方案失败，请稍后重试。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("sellfox", "edit", request);
    if (!permission.ok) return permission.response;
    const organizationId = permission.user.organizationId;
    const workspaceId = workspaceScopeFromRequest(request).workspaceId;
    const body = await request.json().catch(() => ({})) as { action?: string; ids?: string[]; decisionReason?: string };

    if (body.action === "generate") {
      const result = await generateAdsProposals(organizationId, workspaceId);
      return NextResponse.json({ ok: true, ...result });
    }

    if (body.action === "decide") {
      const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === "string") : [];
      if (!ids.length) return NextResponse.json({ error: "缺少方案 ID。" }, { status: 400 });
      // 双人复核语义：批准动作记录 reviewedBy；真实写回发生在 ChangeDraft 执行链（另一复核人）。
      const updated = await prisma.sellfoxAdsProposal.updateMany({
        where: { id: { in: ids }, organizationId, workspaceId, status: "PENDING" },
        data: { status: "APPROVED", reviewedBy: permission.user.id, decisionReason: typeof body.decisionReason === "string" ? body.decisionReason.slice(0, 500) : null },
      });
      return NextResponse.json({ ok: true, approved: updated.count });
    }

    if (body.action === "reject") {
      const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === "string") : [];
      if (!ids.length) return NextResponse.json({ error: "缺少方案 ID。" }, { status: 400 });
      const updated = await prisma.sellfoxAdsProposal.updateMany({
        where: { id: { in: ids }, organizationId, workspaceId, status: "PENDING" },
        data: { status: "REJECTED", reviewedBy: permission.user.id, decisionReason: typeof body.decisionReason === "string" ? body.decisionReason.slice(0, 500) : null },
      });
      return NextResponse.json({ ok: true, rejected: updated.count });
    }

    return NextResponse.json({ error: "未知操作。" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "广告方案操作失败，请稍后重试。" }, { status: 500 });
  }
}

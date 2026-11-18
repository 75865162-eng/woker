import { NextResponse } from "next/server";
import { requireAccessEdit, requireAccessView } from "@/lib/accounts/access-api-guard";
import { getSubjectGrants, saveSubjectGrants, listMcpScopes, type GrantChange } from "@/lib/accounts/access-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const subjectType = url.searchParams.get("subjectType") === "MEMBER" ? "MEMBER" : "ROLE";
  const subjectId = url.searchParams.get("subjectId")?.trim() || "__mcp_matrix__";
  const snapshot = await getSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType,
    subjectId,
  });
  const authorized = new Set(snapshot.grants.filter((g) => g.resourceType === "MCP_TOOL").map((g) => g.resourceId));
  const catalog = listMcpScopes();
  const tools = (["amazon", "sellfox"] as const).flatMap((provider) =>
    catalog[provider].map((name) => ({
      provider,
      name,
      authorized: authorized.has(`${provider}:${name}`),
    })),
  );
  return NextResponse.json({ tools, revision: snapshot.revision });
}

export async function PUT(request: Request) {
  const guard = await requireAccessEdit(request);
  if (!guard.ok) return guard.response;
  const body = (await request.json()) as {
    subjectType?: string;
    subjectId?: string;
    tools?: Array<{ provider: string; name: string; authorized: boolean }>;
    expectedRevision?: string;
  };
  const subjectType = body.subjectType === "MEMBER" ? "MEMBER" : "ROLE";
  const subjectId = body.subjectId?.trim() || "__mcp_matrix__";
  if (!Array.isArray(body.tools) || typeof body.expectedRevision !== "string") {
    return NextResponse.json({ error: "tools / expectedRevision 参数无效。" }, { status: 400 });
  }
  const changes: GrantChange[] = body.tools.map((tool) => ({
    resourceType: "MCP_TOOL",
    resourceId: `${tool.provider}:${tool.name}`,
    actions: tool.authorized ? ["call"] : [],
    scopeJson: { provider: tool.provider },
  }));
  const result = await saveSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType,
    subjectId,
    changes,
    expectedRevision: body.expectedRevision,
    actor: { id: guard.user.id, role: guard.user.role },
  });
  if (!result.ok) {
    return NextResponse.json({ error: "MCP 授权已被他人修改，请刷新后重试。", revision: result.currentRevision }, { status: 409 });
  }
  return NextResponse.json(result);
}

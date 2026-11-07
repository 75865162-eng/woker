import { skillMetaTools, liliInstructions, liliVersion, callSkillMeta, getSkillManifest } from "./skill-manifest";
import { validate } from "@/lib/selection-research/schema";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiPermissionResult } from "@/lib/auth/api-permissions";
import type { PermissionAction } from "@/lib/accounts/permissions";
import { researchMcpTools, callResearchMcpTool, dispatchResearchRequest } from "./research-tools";
import { isResearchTool, researchToolActions } from "./research-grants";
import { publicResearchTools, callPublicResearchTool } from "./public-research-tools";
import { createRuntimeTools } from "./runtime-tools";
import { withResearchRequestAuthorization } from "@/lib/selection-research/request-authorization";
import type { ObjectJson } from "@/lib/selection-research/types";

export type ResearchMcpIdentity = { id: string; organizationId: string; workspaceId: string; userId: string; tools: string[]; revision: number };
export type ResearchBearerDependencies = {
  authenticate: (authorization: string | null, request?: Request) => Promise<ResearchMcpIdentity>;
  permission: (identity: ResearchMcpIdentity, moduleId: string, action: PermissionAction, request: Request) => Promise<ApiPermissionResult>;
  audit: (identity: ResearchMcpIdentity, event: { requestId: string; method: string; tool: string | null; status: "STARTED" | "SUCCEEDED" | "DENIED"; skill?: { id: string; sha256: string; version: string } }) => Promise<void>;
  erp?: (identity: ResearchMcpIdentity) => Promise<import("@/lib/selection-research/types").Transport>;
  marketAccess?: (identity: ResearchMcpIdentity, request: Request) => Promise<ObjectJson>;
  dispatch?: typeof dispatchResearchRequest;
};
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { ...headers, ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="lili-mcp"' } : {}) } });

/** Bearer access is limited to local Skill reads and explicitly granted research commands. */
export async function handleResearchBearerMcp(request: Request, body: Record<string, unknown> | undefined, deps: ResearchBearerDependencies): Promise<Response> {
  let identity: ResearchMcpIdentity | undefined;
  let tool: string | null = null;
  const requestId = randomUUID();
  let method = "UNKNOWN";
  let id: string | number | null = null;
  let recorded = false;
  let skillUsed: { id: string; sha256: string; version: string } | undefined;
  const failure = (status: number) => { const response = json({ jsonrpc: "2.0", id, error: { code: status === 401 ? -32001 : status === 403 ? -32003 : status === 400 ? -32602 : -32603, message: status === 401 ? "Unauthenticated." : status === 403 ? "Forbidden." : status === 400 ? "Invalid request." : "Research request failed." } }, status); if (status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="lili-mcp", resource_metadata="' + new URL("/.well-known/oauth-protected-resource/api/lili/mcp", process.env.LILI_PUBLIC_ORIGIN || request.url).href + '"'); return response; };
  try {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return failure(403);
    identity = await deps.authenticate(request.headers.get("authorization"), request);
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string" || (body.id !== undefined && body.id !== null && typeof body.id !== "string" && typeof body.id !== "number")) return failure(400);
    id = body.id as typeof id ?? null;
    method = ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"].includes(body.method) ? body.method : "UNKNOWN";
    const params = body.params ?? {};
    if (!params || typeof params !== "object" || Array.isArray(params)) return failure(400);
    const args = params as Record<string, unknown>;
    tool = method === "tools/call" && typeof args.name === "string" ? args.name : null;
    const needsErp = method === "tools/list" || method === "tools/call" && typeof args.name === "string" && identity.tools.includes(args.name) && !isResearchTool(args.name);
    const erp = needsErp && deps.erp ? await deps.erp(identity) : undefined;
    const erpDefinitions = erp ? await erp.listTools(request.signal) : [];
    const knownTools = new Set([...researchMcpTools.map(tool => tool.name), ...publicResearchTools.map(tool => tool.name), "meta_search_skills", "meta_load_skill", "meta_list_workflows", ...skillMetaTools.map(tool => tool.name), ...erpDefinitions.map(tool => tool.name)]);
    if (tool && !knownTools.has(tool)) tool = "UNKNOWN";
    await deps.audit(identity, { requestId, method, tool, status: "STARTED" });
    if (!identity.tools.length) return failure(403);
    const authorize = async (moduleId: string, action: PermissionAction, incoming: Request): Promise<ApiPermissionResult> => {
      // Revalidate expiry/revocation/revision and current role for each handler check.
      const current = await deps.authenticate(request.headers.get("authorization"), request);
      const identityChanged = current.id !== identity!.id || current.revision !== identity!.revision || current.userId !== identity!.userId || current.organizationId !== identity!.organizationId || current.workspaceId !== identity!.workspaceId;
      const toolRevoked = tool !== null && isResearchTool(tool) && !current.tools.includes(tool);
      if (identityChanged || toolRevoked || action === "approve") return { ok: false, response: failure(403) };
      const permission = await deps.permission(current, moduleId, action, incoming);
      if (permission.ok && (permission.user.id !== current.userId || permission.user.organizationId !== current.organizationId)) return { ok: false, response: failure(403) };
      return permission;
    };
    const view = await authorize(identity.tools.some(isResearchTool) ? "agents" : "operations", "view", request);
    if (!view.ok) return view.response;
    const skills = createRuntimeTools([]);
    let result: unknown;
    if (method === "initialize") {
      if (!["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(args.protocolVersion))) return failure(400);
      result = { protocolVersion: args.protocolVersion, serverInfo: { name: "lili-mcp", version: liliVersion }, capabilities: { tools: {} }, instructions: liliInstructions };
    } else if (method === "notifications/initialized") {
      if (body.id !== undefined) return failure(400);
      await deps.audit(identity, { requestId, method, tool, status: "SUCCEEDED" });
      recorded = true;
      return new Response(null, { status: 202, headers });
    } else if (method === "ping") result = {};
    else if (method === "tools/list") {
      const granted = [];
      for (const definition of researchMcpTools) {
        if (!isResearchTool(definition.name) || !identity.tools.includes(definition.name)) continue;
        if ((await authorize("agents", researchToolActions[definition.name], request)).ok) granted.push({ ...definition,
          inputSchema: { ...definition.inputSchema, properties: { ...(definition.inputSchema.properties as ObjectJson), workspaceId: { type: "string", const: identity.workspaceId } } },
        });
      }
      result = { tools: [...(await skills.discover()).tools, ...publicResearchTools, ...granted, ...erpDefinitions] };
    } else if (method === "tools/call") {
      if (!tool || tool === "UNKNOWN") return failure(403);
      const input = args.arguments ?? {};
      if (!input || typeof input !== "object" || Array.isArray(input)) return failure(400);
      let output: unknown;
      if (erpDefinitions.some(definition => definition.name === tool)) {
        const current = await deps.authenticate(request.headers.get("authorization"), request);
        if (current.id !== identity.id || current.revision !== identity.revision) return failure(403);
        output = await erp!.callTool(tool, input as ObjectJson, request.signal);
      } else if (skillMetaTools.some(definition => definition.name === tool)) { validate(skillMetaTools.find(definition => definition.name === tool)!.inputSchema, input as ObjectJson); output = tool === "meta_get_market_access" && deps.marketAccess ? await deps.marketAccess(identity, request) : await callSkillMeta(tool, input as ObjectJson, true); }
      else if (isResearchTool(tool)) {
        if (!identity.tools.includes(tool)) return failure(403);
        const permission = await authorize("agents", researchToolActions[tool], request);
        if (!permission.ok) return permission.response;
        const command = input as ObjectJson;
        if (command.workspaceId !== undefined && command.workspaceId !== identity.workspaceId || command.erpCredentialId !== undefined && command.erpCredentialId !== identity.id) return failure(403);
        output = await callResearchMcpTool(request, tool, tool === "research_start" ? { ...command, workspaceId: identity.workspaceId, erpCredentialId: identity.id } : { ...command, workspaceId: identity.workspaceId }, (child, runId) => withResearchRequestAuthorization(child, { credentialId: identity!.id, authorize }, () => (deps.dispatch ?? dispatchResearchRequest)(child, runId)));
        // External clients need navigable human-review links; browser routes keep their relative links.
        const links = output as { reviewUrl?: string; downloadUrl?: string; stageReports?: { stage: number; url: string }[] };
        if (links.reviewUrl) links.reviewUrl = new URL(links.reviewUrl, request.url).href;
        if (links.downloadUrl) links.downloadUrl = new URL(links.downloadUrl, request.url).href;
        if (links.stageReports) links.stageReports = links.stageReports.map(report => ({ ...report, url: new URL(report.url, request.url).href }));
      } else if (publicResearchTools.some(definition => definition.name === tool)) output = await callPublicResearchTool(tool, input as ObjectJson);
      else output = await skills.call(tool, input as ObjectJson, request.signal);
      if ((tool === "meta_load_skill" || tool === "meta_get_skill_manifest") && output && typeof output === "object" && "manifest" in output) {
        const manifest = output.manifest as Awaited<ReturnType<typeof getSkillManifest>>;
        skillUsed = { id: manifest.skill_id, sha256: manifest.sha256, version: manifest.version };
      }
      const isError = Boolean(output && typeof output === "object" && "ok" in output && output.ok === false);
      await deps.audit(identity, { requestId, method, tool, status: isError ? "DENIED" : "SUCCEEDED", ...(skillUsed ? { skill: skillUsed } : {}) });
      recorded = true;
      return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output) }], isError } });
    } else return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } });
    await deps.audit(identity, { requestId, method, tool, status: "SUCCEEDED" });
    recorded = true;
    return json({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && [401, 403].includes(Number(error.status)) ? Number(error.status) : error instanceof Error && /^(SCHEMA_|CREDENTIAL)/.test(error.message) ? 400 : 503;
    return failure(status);
  } finally {
    if (identity && !recorded) await deps.audit(identity, { requestId, method, tool, status: "DENIED" }).catch(() => {});
  }
}

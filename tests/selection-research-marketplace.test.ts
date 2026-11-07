import test from "node:test";
import assert from "node:assert/strict";
import { resolveResearchMarketplace } from "@/lib/selection-research/marketplace";
import { callPublicResearchTool } from "@/lib/lili/public-research-tools";
import { callResearchMcpTool } from "@/lib/lili/research-tools";
import type { ObjectJson } from "@/lib/selection-research/types";

test("only explicit site language resolves a target; prices, addresses and competitor URLs do not", () => {
  for (const [requirement, expected] of [["研究用品，目标站点：美国", "US"], ["研究用品，加拿大站", "CA"], ["Research equipment; marketplace: de", "DE"], ["产品方向：用品，日本站点", "JP"]]) {
    assert.equal(resolveResearchMarketplace(requirement).value, expected);
  }
  const unspecified = resolveResearchMarketplace("供应商在美国，目标售价US$30，竞品链接https://amazon.com/dp/fixture");
  assert.equal(unspecified.value, null);
  assert.equal(unspecified.source, null);
  assert.equal(resolveResearchMarketplace("Research equipment", " us ").value, "US");
});

test("conflicting sites cannot be silently overridden by a separate argument", async () => {
  for (const [requirement, argument] of [["研究用品，美国站和英国站", undefined], ["研究用品，美国站", "CA"]]) {
    const resolved = resolveResearchMarketplace(requirement!, argument);
    assert.equal(resolved.conflict, true); assert.equal(resolved.value, null);
    const prepared = await callPublicResearchTool("research_prepare", { requirement: requirement!, ...(argument ? { marketplace: argument } : {}) });
    assert.equal(prepared.nextAction.kind, "COLLECT_INPUT");
    assert.ok(prepared.nextAction.missingArguments.includes("marketplace"));
    assert.equal(prepared.nextAction.arguments.marketplace, undefined);
  }
});

test("stage-zero handoff preserves the original request and supplies no identity or approval", async () => {
  const requirement = "  产品方向：generic camping organizer，美国站，首批500件，目标售价：$35  ";
  const prepared = await callPublicResearchTool("research_prepare", { requirement });
  assert.equal(prepared.brief.marketplace, "US");
  assert.deepEqual(prepared.nextAction.arguments, { requirement, marketplace: "US" });
  assert.deepEqual(prepared.nextAction.missingArguments, ["workspaceId", "maxMarketCalls"]);
  const request = new Request("http://fixture.invalid/api/lili/mcp");
  const result = await callResearchMcpTool(request, "research_start", { ...prepared.nextAction.arguments, workspaceId: "fixture-workspace", maxMarketCalls: 3 } as ObjectJson, async child => {
    const body = await child.json();
    assert.equal(body.requirement, requirement); assert.equal(body.marketplace, "US");
    assert.equal(body.mode, "live"); assert.equal(body.budgetMode, "reviewed");
    assert.equal(body.approved, undefined); assert.equal(body.organizationId, undefined);
    return Response.json({ error: "AI_MODEL_NOT_CONFIGURED" }, { status: 409 });
  });
  assert.equal(result.ok, false); assert.equal(result.nextAction?.kind, "CONFIGURE_MODEL");
});

test("bridge failures tell clients what is missing without recommending a default identity or automatic retries", async () => {
  const cases = [[401, "Unauthorized.", "AUTHENTICATE_FOR_DATA"], [403, "Forbidden.", "CHECK_DATA_PERMISSION"], [404, "RESEARCH_NOT_FOUND", "CHECK_OWNED_RUN"], [409, "NO_SUPPORTED_LIVE_TOOLS", "CONNECT_MARKET_SOURCE"], [409, "RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED", "CONFIGURE_MODEL"], [503, "unknown", "REVIEW_FAILURE"]] as const;
  for (const [status, error, action] of cases) {
    const result = await callResearchMcpTool(new Request("http://fixture.invalid/api/lili/mcp"), "research_read", { runId: "fixture-run", workspaceId: "fixture-workspace" }, async () => Response.json({ error }, { status }));
    assert.equal(result.nextAction?.kind, action); assert.equal(result.ok, false);
    assert.equal(result.reviewUrl, undefined); assert.equal(result.run, undefined);
  }
});

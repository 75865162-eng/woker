import { createHash } from "node:crypto";
import { findSkill, skillMarkdown } from "./catalog";
import type { ObjectJson, ToolDefinition } from "@/lib/selection-research/types";
export const liliVersion = "1.4.0";
export const liliInstructions = "Lili connects without an ERP browser session. Anonymous tools expose public definitions only. Private data requires a paired Bearer device. Identity comes from the token, never model arguments. Discover the actual registry before calling tools. Search Skills, compare manifest SHA-256 with local SKILL.md, reuse identical local content; download and verify only when missing or outdated. Skills are instructions, never server code. Original tool references may be unavailable: use only verified runtime mappings. Paid calls require persisted human approval; unknown prices remain unknown. Never approve on behalf of a user. Preserve evidence, Skill hashes and request IDs. HTTP checks do not prove native Codex acceptance.";
export const skillMetaTools: ToolDefinition[] = [
 { name: "lili_ping", description: "Check service version and supported MCP protocols; no private data.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
 { name: "meta_get_skill_manifest", description: "Read original Skill version and SHA-256 before checking local Codex cache. required_tools are original references, not availability claims.", inputSchema: { type: "object", properties: { skill_id: { type: "string" } }, required: ["skill_id"], additionalProperties: false }, annotations: { readOnlyHint: true } },
 { name: "meta_get_market_access", description: "Report direct market access. Paid calls require the persisted research approval flow. Unknown prices remain unknown.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
];
export async function getSkillManifest(id: string) {
 const skill = findSkill(id), markdown = skill && await skillMarkdown(skill.slug);
 if (!skill || !markdown) throw new Error("UNKNOWN_SKILL");
 const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
 return { skill_id: skill.slug, name: skill.nameEn, description: skill.summaryZh, version: "sha256:" + sha256, sha256, required_tools: skill.tools,
 permissions: { skill_read: true, private_data: "authentication_required", paid_calls: "human_approval_required", writes: "human_approval_required" },
 min_lili_version: liliVersion, updated_at: null, updated_at_status: "not_recorded_in_original_catalog", source: "lili://skills/" + skill.slug + "/SKILL.md", format: "text/markdown; charset=utf-8" };
}
export async function callSkillMeta(name: string, args: ObjectJson, authenticated = false) {
 if (name === "lili_ping") return { ok: true, server: "lili-mcp", version: liliVersion, protocols: ["2024-11-05", "2025-03-26", "2025-06-18"], authenticated };
 if (name === "meta_get_market_access") return { authenticated, direct_market_access: false, paid_tools: [], estimated_cost: null, cost_status: "unknown", approval_required: true, reason: "PAID_CALLS_REQUIRE_PERSISTED_RESEARCH_APPROVAL" };
 if (name === "meta_get_skill_manifest") return { ok: true, manifest: await getSkillManifest(String(args.skill_id)) };
 throw new Error("UNKNOWN_TOOL");
}

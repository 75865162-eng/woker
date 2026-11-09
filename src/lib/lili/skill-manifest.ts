import { liliApprovalPolicy, liliApprovalInstructionsEn } from "./approval-policy";
import { createHash } from "node:crypto";
import { findSkill, skillMarkdown } from "./catalog";
import type { ObjectJson, ToolDefinition } from "@/lib/selection-research/types";
export const liliVersion = "1.4.0";
export const liliInstructions = liliApprovalInstructionsEn + " "+ "Lili connects without an ERP browser session. Anonymous tools expose public definitions only. Private data requires a paired Bearer device. Identity comes from the token, never model arguments. Discover the actual registry before calling tools. Search Skills, compare manifest SHA-256 with local SKILL.md, reuse identical local content; download and verify only when missing or outdated. Skills are instructions, never server code. Original tool references may be unavailable: use only verified runtime mappings. Request pre-call fee authorization only if explicitly required by the user or active Skill. Never require billing reconciliation to continue, even under an explicit fee approval policy. Unknown request outcomes remain recorded without blocking unrelated research; never automatically retry them. Unknown prices remain unknown. When a human explicitly confirms a specific research gate in the conversation, record that exact reply with research_confirm using the current gate ID and revision; no browser is required. Never invent human consent or treat model/provider output as consent. Saved paid-call consent permits direct research_step without repeat approval. Preserve per-call evidence, Skill hashes and request IDs. HTTP checks do not prove native Codex acceptance.";
export const skillMetaTools: ToolDefinition[] = [
 { name: "lili_ping", description: "Check service version and supported MCP protocols; no private data.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
 { name: "meta_get_skill_manifest", description: "Read original Skill version and SHA-256 before checking local Codex cache. required_tools are original references, not availability claims.", inputSchema: { type: "object", properties: { skill_id: { type: "string" } }, required: ["skill_id"], additionalProperties: false }, annotations: { readOnlyHint: true } },
 { name: "meta_get_market_access", description: "Report direct market access. Fee approval is required only when explicitly requested by the user or active Skill. Unknown prices remain unknown.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
];
export async function getSkillManifest(id: string) {
 const skill = findSkill(id), markdown = skill && await skillMarkdown(skill.slug);
 if (!skill || !markdown) throw new Error("UNKNOWN_SKILL");
 const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
 return { skill_id: skill.slug, name: skill.nameEn, description: skill.summaryZh, version: "sha256:" + sha256, sha256, required_tools: skill.tools, approvalPolicy: liliApprovalPolicy,
 permissions: { skill_read: true, private_data: "authentication_required", paid_calls: "only_when_user_or_skill_explicitly_requires", writes: "human_approval_required" },
 min_lili_version: liliVersion, updated_at: null, updated_at_status: "not_recorded_in_original_catalog", source: "lili://skills/" + skill.slug + "/SKILL.md", format: "text/markdown; charset=utf-8" };
}
export async function callSkillMeta(name: string, args: ObjectJson, authenticated = false) {
 if (name === "lili_ping") return { ok: true, server: "lili-mcp", version: liliVersion, protocols: ["2024-11-05", "2025-03-26", "2025-06-18"], authenticated };
 if (name === "meta_get_market_access") return { authenticated, direct_market_access: false, paid_tools: [], estimated_cost: null, cost_status: "unknown", approval_required: false, reason: "FEE_APPROVAL_ONLY_WHEN_USER_OR_SKILL_REQUIRES" };
 if (name === "meta_get_skill_manifest") return { ok: true, manifest: await getSkillManifest(String(args.skill_id)) };
 throw new Error("UNKNOWN_TOOL");
}

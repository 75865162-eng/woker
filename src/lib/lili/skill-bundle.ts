import JSZip from "jszip";
import { listSkills, skillMarkdown } from "./catalog";

export async function createSkillBundle(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip();
  zip.file("INSTALL.md", `# Lili 技能说明包\n\n本包保留技能说明，不包含凭证或可自动安装的 MCP 配置。\n\n将所需 skills/<slug>/SKILL.md 安装到自己的技能目录前，请先阅读内容。说明中的工具名不代表已接入或已获授权；外部写入仍须审批。\n\n主系统个人 Amazon MCP 在同步中心管理，使用独立个人凭证与明确店铺范围。/api/lili/mcp 是 ERP 会话保护的目录接口，不能作为个人 Amazon MCP 替代。\n`);
  for (const skill of listSkills()) {
    const markdown = await skillMarkdown(skill.slug);
    if (!markdown) throw new Error("LILI_SKILL_BODY_MISSING");
    zip.file(`skills/${skill.slug}/SKILL.md`, markdown);
  }
  return Uint8Array.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

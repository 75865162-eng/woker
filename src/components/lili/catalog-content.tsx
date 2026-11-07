import Link from "next/link";
import { notFound } from "next/navigation";
import { SkillGrid } from "./skill-grid";
import { CaseGrid } from "./case-grid";
import { CopyButton } from "./copy-button";
import { ToolLab } from "./tool-lab";
import { ToolRunner } from "./tool-runner";
import { ToolConfigView } from "./tool-config-view";
import { RunLiveButton } from "./run-live-button";
import { findSkill, listSkills, listTools, listWorkflows, skillMarkdown } from "@/lib/lili/catalog";
import { tx, type Locale } from "@/lib/lili/tx";

const explanation = "工具定义与执行能力分别标注；业务操作继续使用主系统的权限、审批和草稿流程。";

export async function CatalogContent({ kind, slug, locale }: { kind: string; slug?: string; locale: Locale }) {
  if (kind === "tool-config") return <ToolConfigView locale={locale} />;
  if (kind === "start") return <div className="space-y-5">
    <section className="lili-card space-y-3 p-5">
      <h1 className="text-xl font-bold">粒粒 Lili · 运营技能中心</h1>
      <p className="text-sm leading-6">Lili 已并入本系统，沿用当前 ERP 账号与权限，无需单独注册或登录。技能、工具和工作流目录由当前应用直接提供。</p>
      <p className="text-sm text-muted">{listSkills().length} 个技能 · {listTools().length} 个工具定义 · {listWorkflows().length} 个工作流</p>
      <a className="lili-btn-orange" href="/api/lili/codex-bundle" download>下载全部技能</a>
      <p className="text-xs text-muted">下载包含技能说明。个人 Amazon MCP 继续在同步中心创建凭证；本目录不会自动授予工具或店铺访问权限。</p>
    </section>
    <div className="grid gap-3 md:grid-cols-2">
      {[
        ["/lili/v2/skills", "查技能", "搜索、分类、复制提示词并查看完整步骤。"],
        ["/lili/v2/cases", "选工作流", "按定义逐步查看，不自动执行店铺操作。"],
        ["/agents/selection-research", "ASIN 选品研究", "真实来源取证、两次人工确认、HTML 报告和历史恢复。"],
        ["/agents", "Agent 执行与审批", "进入主系统已有执行轨迹和人工审批。"],
        ["/operations", "店铺、同步与 MCP", "使用当前工作区已授权的数据源与个人凭证。"],
      ].map(([href, title, description]) => <Link key={href} href={href} prefetch={false} className="lili-card space-y-2 p-4 hover:border-brand"><h2 className="font-semibold">{title}</h2><p className="text-sm text-muted">{description}</p></Link>)}
    </div>
    <p className="text-sm text-muted">{explanation} 历史独立库记录和密钥没有自动导入。</p>
  </div>;

  if (kind === "skills") {
    if (!slug) return <SkillGrid locale={locale} items={listSkills()} />;
    const skill = findSkill(slug);
    if (!skill) notFound();
    const markdown = await skillMarkdown(skill.slug);
    return <article className="space-y-4">
      <Link href="/lili/v2/skills">← 全部技能</Link>
      <h1 className="text-xl font-bold">{tx(locale, skill.nameZh, skill.nameEn)}</h1>
      <p>{tx(locale, skill.summaryZh, skill.summaryEn)}</p>
      <CopyButton locale={locale} text={tx(locale, skill.promptZh, skill.promptEn)} />
      <h2 className="font-semibold">{tx(locale, "完整技能说明", "Full skill procedure")}</h2>
      <pre className="lili-card overflow-auto whitespace-pre-wrap p-4 text-sm leading-7">{markdown}</pre>
      <h2 className="font-semibold">相关工具</h2><ul className="flex flex-wrap gap-3">{skill.tools.map((name) => <li key={name}><Link className="underline" href={`/lili/v2/tools/${name}`}>{name}</Link></li>)}</ul>
      <h2 className="font-semibold">相关工作流</h2><ul className="space-y-2">{listWorkflows().filter((workflow) => workflow.steps.some((step) => step.skill === skill.slug)).map((workflow) => <li key={workflow.slug}><Link className="underline" href={`/lili/v2/cases/${workflow.slug}`}>{tx(locale, workflow.titleZh, workflow.titleEn)}</Link></li>)}</ul>
    </article>;
  }

  if (kind === "cases" || kind === "workflows") {
    const workflows = listWorkflows();
    if (!slug) return <div className="space-y-4"><p className="text-sm text-muted">工作流定义已保留。自动执行器尚未映射，不生成虚构报告或执行状态。实际任务与审批请进入 <Link className="underline" href="/agents">Agent 中心</Link>。</p>{kind === "cases" ? <CaseGrid locale={locale} items={workflows} /> : <ul className="space-y-2">{workflows.map((row) => <li key={row.slug}><Link className="lili-card block p-4" href={`/lili/v2/workflows/${row.slug}`}>{row.index}. {tx(locale, row.titleZh, row.titleEn)}</Link></li>)}</ul>}</div>;
    const workflow = workflows.find((row) => row.slug === slug);
    if (!workflow) notFound();
    return <article className="space-y-4">
      <Link href="/lili/v2/cases">← 全部工作流模板</Link>
      <h1 className="text-xl font-bold">{tx(locale, workflow.titleZh, workflow.titleEn)}</h1>
      <p>{tx(locale, workflow.summaryZh, workflow.summaryEn)}</p>
      <CopyButton locale={locale} text={tx(locale, workflow.promptZh, workflow.promptEn)} />
      <ol className="space-y-3">{workflow.steps.map((step) => <li key={step.n} className="lili-card p-4"><p>{step.n}. {tx(locale, step.zh, step.en)}</p>{step.skill && (findSkill(step.skill) ? <Link className="text-sm underline" href={`/lili/v2/skills/${step.skill}`}>{step.skill}</Link> : <p className="text-sm text-amber-800">{step.skill}：原始源码包未附此技能定义。</p>)}</li>)}</ol>
      <pre className="lili-card overflow-auto whitespace-pre-wrap p-4 text-sm leading-7">{tx(locale, workflow.promptZh, workflow.promptEn)}</pre>
      <p className="text-sm text-amber-800">尚未映射自动执行器；下方检查不会创建任务或调用外部服务。</p>
      <RunLiveButton slug={slug} locale={locale} />
    </article>;
  }

  if (kind === "tools") {
    if (!slug) return <ToolLab locale={locale} tools={listTools().map(({ name, description, category, readOnly, availability }) => ({ name, description, category, readOnly, availability }))} />;
    const tool = listTools().find((row) => row.name === slug);
    if (!tool) notFound();
    return <div className="space-y-4"><Link href="/lili/v2/tools">← 全部工具</Link><h1 className="text-xl font-bold">{tool.name}</h1>
      <p className="rounded-lg bg-amber-50 p-3 text-sm">{tool.availability === "catalog" ? "已接入本应用的静态目录查询，不读取店铺业务数据。" : "定义已保留，主系统业务执行器尚未映射。运行会明确返回未实现，不产生业务写入。"}</p>
      <ToolRunner locale={locale} name={tool.name} description={tool.description} docs={tool.docs} schema={tool.inputSchema} readOnly={tool.readOnly} profileId="" />
      <p className="text-sm text-muted">原独立 Lili 调用历史未迁移。现有业务执行轨迹请在 <Link href="/agents" className="underline">Agent 中心</Link>查看。</p>
    </div>;
  }

  if (kind === "approvals") return <section className="lili-card space-y-3 p-5"><h1 className="text-xl font-semibold">统一审批与执行</h1><p>业务审批由主系统 Agent 工作台承接，按原有角色和工作区校验。独立 Lili 审批记录未迁移。</p><div className="flex flex-wrap gap-3"><Link className="lili-btn-orange" href="/agents">Agent 中心</Link><Link className="lili-btn-ghost" href="/agents/orchestrator">编排与 Launch 审批</Link><Link className="lili-btn-ghost" href="/agents/ppc">PPC 执行与审批</Link></div></section>;
  if (kind === "recharge") return <section className="lili-card space-y-3 p-5"><h1 className="text-xl font-semibold">充值</h1><p>主系统未接入 Lili 积分与支付。没有创建账户余额、充值订单或收款请求；历史独立库订单未迁移。</p></section>;
  if (kind === "help") return <section className="lili-card space-y-3 p-5"><h1 className="text-xl font-semibold">使用帮助</h1><p>从技能目录查步骤、复制提示词；工作流模板提供执行顺序。实际业务进入主系统各工作台，使用已有授权、审批与草稿。</p><p>工具页标明当前执行能力。目录中的工具名或技能说明不授予数据访问和写入权限。</p><a className="lili-btn-orange" href="/api/lili/codex-bundle" download>下载全部技能</a><Link className="ml-3 underline" href="/operations">同步中心与个人 MCP</Link></section>;
  notFound();
}

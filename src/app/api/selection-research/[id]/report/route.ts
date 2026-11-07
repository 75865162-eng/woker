import { researchAccess, researchError } from "@/lib/selection-research/server";
import { renderResearchReport, renderResearchStageReport } from "@/lib/selection-research/report";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = (await context.params).id;
    const access = await researchAccess(request, "export", { runId: id }); if (!access.ok) return access.response;
    const run = await access.engine.inspect(id);
    const stage = new URL(request.url).searchParams.get("stage");
    const html = stage === null ? renderResearchReport(run) : renderResearchStageReport(run, Number(stage));
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="selection-${run.id}${stage === null ? "" : `-stage-${Number(stage)}`}.html"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" } });
  } catch (error) { return researchError(error); }
}

import { researchAccess, researchError } from "@/lib/selection-research/server";
import { renderResearchReport } from "@/lib/selection-research/report";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = (await context.params).id;
    const access = await researchAccess(request, "export", { runId: id }); if (!access.ok) return access.response;
    const run = await access.engine.inspect(id);
    return new Response(renderResearchReport(run), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="selection-${run.id}.html"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" } });
  } catch (error) { return researchError(error); }
}

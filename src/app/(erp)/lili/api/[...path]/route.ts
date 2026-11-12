// Legacy browser fetch URLs remain in-process and share host authorization.
import { handleLiliRequest } from "@/lib/lili/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  return handleLiliRequest(request, (await context.params).path);
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };

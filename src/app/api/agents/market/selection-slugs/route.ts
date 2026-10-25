import { selectionLocalApi } from "@/lib/agent-platform/selection-local-api";

export const runtime = "nodejs";
export async function GET(request: Request) { return selectionLocalApi(request, "slugs"); }

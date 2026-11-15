// Next.js route modules may only export the documented route fields. The
// implementation (including getProductsResponse, which the dashboard server
// component reuses) lives in ./handler.ts in the same directory.
export const runtime = "nodejs";
export { GET, POST } from "./handler";

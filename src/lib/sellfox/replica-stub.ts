import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";

export async function sellfoxEmptyStub(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("pageSize") || "20");
  return NextResponse.json({
    rows: [],
    totals: [],
    facets: { productTags: [], salespersons: [] },
    pagination: {
      page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
      pageSize: [20, 50, 100].includes(pageSize) ? pageSize : 20,
      total: 0,
    },
    stub: true,
    message: "暂无数据 / 待接赛狐",
  });
}

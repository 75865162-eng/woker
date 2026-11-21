import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/session";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { resolveSellfoxVisibleStoreIds } from "@/lib/sellfox/store-access";
import { readDashboard } from "@/lib/sellfox/dashboard-read";

export const runtime = "nodejs";

/**
 * 首页经营作战看板（登录即可访问）。
 * 登录鉴权 + 工作区 scope + 赛狐店铺三态收窄，全部复用成熟链路，绝不绕过。
 * 用户无赛狐授权时，resolveSellfoxVisibleStoreIds 返回 []，看板只显示空卡片而非整页报错。
 */
export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user?.organizationId) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const scope = workspaceScopeFromRequest(request);
  const where = { organizationId: user.organizationId, workspaceId: scope.workspaceId };

  try {
    // 店铺可见性三态与概览/明细同源；内部已做工作区访问 + 成员状态校验（失败抛 403）。
    let authorizedStoreIds: string[] | undefined;
    try {
      authorizedStoreIds = await resolveSellfoxVisibleStoreIds({ id: user.id, role: user.role }, where);
    } catch {
      // 无赛狐数据访问权的用户：按空集处理，看板赛狐卡片为空，不影响其它模块。
      authorizedStoreIds = [];
    }

    const data = await readDashboard(
      { organizationId: where.organizationId, workspaceId: where.workspaceId, userId: user.id },
      authorizedStoreIds,
    );
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "读取经营看板失败，请稍后重试。" }, { status: 500 });
  }
}

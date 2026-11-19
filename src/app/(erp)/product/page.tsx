import { getProductsResponse } from "@/app/api/products/handler";
import { AppShell } from "@/components/app-shell/app-shell";
import { ProductWorkbench } from "@/components/app-shell/lazy-workbenches";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { getCurrentUser } from "@/lib/auth/session";
import type { RolePermissionMap } from "@/lib/accounts/permissions";
import type { ProductListItem, ProductListSummary } from "@/lib/products/types";
import { cookies, headers } from "next/headers";

const workspaceScopeCookieName = "amazon_bulk_ad_workspace_scope";

type ProductHomeInitialData = {
  workspaceId: string;
  products: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  summary: ProductListSummary;
};

function readWorkspaceId(value: string | undefined) {
  if (!value) return "default";

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as { workspaceId?: unknown };
    return typeof parsed.workspaceId === "string" && parsed.workspaceId.trim()
      ? parsed.workspaceId.trim()
      : "default";
  } catch {
    return "default";
  }
}

async function getProductHomeInitialData(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  permissions: Promise<RolePermissionMap>,
): Promise<ProductHomeInitialData | null> {
  if (!user) return null;

  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);

  const workspaceId = readWorkspaceId(cookieStore.get(workspaceScopeCookieName)?.value);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const request = new Request(
    `${protocol}://${host}/api/products?page=1&pageSize=20&detail=list&includeSummary=true`,
    {
      headers: {
        cookie: cookieStore.toString(),
        "x-workspace-id": workspaceId,
      },
    },
  );
  const response = await getProductsResponse(request, { user, permissions });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    products?: ProductListItem[];
    pagination?: ProductHomeInitialData["pagination"];
    summary?: ProductListSummary;
  };

  if (!payload.pagination || !payload.summary || !Array.isArray(payload.products)) {
    return null;
  }

  return {
    workspaceId,
    products: payload.products,
    pagination: payload.pagination,
    summary: payload.summary,
  };
}

/** 商品管理一级落地页：商品主档（原 /dashboard 实现，URL 统一为 /product）。 */
export default async function ProductHomePage() {
  const user = await getCurrentUser();
  const rolePermissionsSnapshotPromise = user
    ? getOrganizationRolePermissionsSnapshot(user.organizationId)
    : null;
  const [initialData] = user
    ? await Promise.all([
      getProductHomeInitialData(
        user,
        rolePermissionsSnapshotPromise!.then((snapshot) => snapshot.permissions),
      ),
      rolePermissionsSnapshotPromise!,
    ])
    : [null, null];

  return (
    <AppShell
      title="产品管理"
      subtitle="商品资料、竞品 ASIN、供应商与尺寸重量的统一工作台"
    >
      <ProductWorkbench initialData={initialData ?? undefined} />
    </AppShell>
  );
}

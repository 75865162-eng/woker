import type { Product } from "@/lib/products/types";
import { normalizeAssigneeList } from "@/lib/products/workflow";

export type ProductEditUser = {
  name?: string | null;
  role?: string | null;
};

export function isProductSupervisorOrAdmin(user: ProductEditUser | null | undefined) {
  return user?.role === "owner" || user?.role === "database_admin" || user?.role === "operations_supervisor";
}

export function getOperationsConfirmingEditors(product: Pick<Product, "opsAssignee" | "opsAssignees" | "editableBy">) {
  return normalizeAssigneeList(undefined, [
    ...normalizeAssigneeList(product.opsAssignee, product.opsAssignees),
    ...(product.editableBy ?? []),
  ]);
}

export function canEditOperationsConfirmingProduct(product: Product, user: ProductEditUser | null | undefined) {
  if (isProductSupervisorOrAdmin(user)) return true;

  const userName = user?.name?.trim();
  if (!userName) return false;

  return getOperationsConfirmingEditors(product).includes(userName);
}

export function canChangeDelistedProductStatus(user: ProductEditUser | null | undefined) {
  return isProductSupervisorOrAdmin(user);
}

export function getProductEditRestriction(
  existingProduct: Product | null | undefined,
  nextProduct: Product,
  user: ProductEditUser | null | undefined,
) {
  if (!existingProduct) return "";

  if (
    existingProduct.status === "delisted" &&
    nextProduct.status !== existingProduct.status &&
    !canChangeDelistedProductStatus(user)
  ) {
    return "已下架 SKU 的状态只能由主管或管理员更改。";
  }

  if (existingProduct.status === "ops_review" && !canEditOperationsConfirmingProduct(existingProduct, user)) {
    const editors = getOperationsConfirmingEditors(existingProduct).join("、") || "当前转交运营";

    return `运营确认中的商品只能由 ${editors}、主管或管理员编辑。`;
  }

  return "";
}

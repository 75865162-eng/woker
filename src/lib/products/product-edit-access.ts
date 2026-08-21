import type { Product } from "@/lib/products/types";
import { normalizeAssigneeList } from "@/lib/products/workflow";

export type ProductEditUser = {
  name?: string | null;
  role?: string | null;
};

export type ProductEditIntent =
  | "edit_basic"
  | "change_status"
  | "edit_operations"
  | "edit_design"
  | "edit_listing"
  | "restore_version"
  | "import_update";

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

export function canEditProduct(product: Product, user: ProductEditUser | null | undefined, intent: ProductEditIntent) {
  if (isProductSupervisorOrAdmin(user)) return true;

  if (intent === "change_status" && product.status === "delisted") {
    return false;
  }

  if (product.status === "ops_review") {
    return canEditOperationsConfirmingProduct(product, user);
  }

  return true;
}

export function getProductEditRestrictionMessage(product: Product, user: ProductEditUser | null | undefined, intent: ProductEditIntent) {
  if (canEditProduct(product, user, intent)) return "";

  if (intent === "change_status" && product.status === "delisted") {
    return "已下架 SKU 的状态只能由主管或管理员更改。";
  }

  if (product.status === "ops_review") {
    const editors = getOperationsConfirmingEditors(product).join("、") || "当前转交运营";

    return `运营确认中的商品只能由 ${editors}、主管或管理员编辑。`;
  }

  return "当前账号无权编辑该商品。";
}

export function getProductEditRestriction(
  existingProduct: Product | null | undefined,
  nextProduct: Product,
  user: ProductEditUser | null | undefined,
  intent: ProductEditIntent = "edit_basic",
) {
  if (!existingProduct) return "";

  if (existingProduct.status !== nextProduct.status) {
    const statusRestriction = getProductEditRestrictionMessage(existingProduct, user, "change_status");

    if (statusRestriction) return statusRestriction;
  }

  const editRestriction = getProductEditRestrictionMessage(existingProduct, user, intent);

  return editRestriction;
}

import { redirect } from "next/navigation";

/** 一级命名空间 /purchase → 采购管理落地页：采购计划。 */
export default function PurchaseLandingPage() {
  redirect("/operations/purchase-plans");
}

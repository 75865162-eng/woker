import { redirect } from "next/navigation";

/** 一级命名空间 /purchase → 采购管理落地页：采购计划 /purchase/plans。 */
export default function PurchaseLandingPage() {
  redirect("/purchase/plans");
}

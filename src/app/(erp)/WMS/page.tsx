import { redirect } from "next/navigation";

/** 一级命名空间 /WMS → 仓库管理（含物流发货）落地页：FBA 库存。 */
export default function WmsLandingPage() {
  redirect("/operations?view=inventory");
}

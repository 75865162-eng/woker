import { redirect } from "next/navigation";

/** 一级命名空间 /Product → 商品管理落地页：商品主档。 */
export default function ProductLandingPage() {
  redirect("/dashboard");
}

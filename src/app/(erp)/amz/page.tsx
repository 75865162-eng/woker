import { redirect } from "next/navigation";

/** 一级命名空间 /amz → 亚马逊数据落地页：销售与流量。 */
export default function AmzLandingPage() {
  redirect("/operations?view=sales-traffic");
}

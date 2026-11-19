import { redirect } from "next/navigation";

/** 一级命名空间 /amz → 亚马逊数据落地页：销售与流量 /amazon/sales-traffic。 */
export default function AmzLandingPage() {
  redirect("/amazon/sales-traffic");
}

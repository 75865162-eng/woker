import { redirect } from "next/navigation";

/** 一级命名空间 /Fin → 财务管理落地页：财务交易。 */
export default function FinLandingPage() {
  redirect("/operations?view=finance");
}

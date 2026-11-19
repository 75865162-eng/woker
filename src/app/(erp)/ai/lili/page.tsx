import { redirect } from "next/navigation";

/**
 * /ai/lili → 现有 Lili 技能中心（/lili）。
 * 命名空间后缀 /ai/* 与真实的 /lili 页面共存，不重复实现技能中心。
 */
export default function AiLiliLandingPage() {
  redirect("/lili");
}

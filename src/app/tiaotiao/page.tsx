import { StaffLoginForm } from "@/components/auth/staff-login-form";

/**
 * Pinyin internal staff sign-in route ("tiaotiao" = 条条).
 * Deliberately separated from the public brand homepage at `/`. Uses the exact
 * same credential flow as the legacy /HKQ and /login routes; those remain as
 * compatibility aliases so existing bookmarks and internal links keep working.
 */
export default function TiaotiaoLoginPage() {
  return <StaffLoginForm />;
}

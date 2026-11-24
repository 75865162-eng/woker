import { StaffLoginForm } from "@/components/auth/staff-login-form";

/**
 * Legacy internal sign-in route kept for compatibility with existing links
 * and browser tests. The canonical internal sign-in route is /HKQ.
 */
export default function LoginPage() {
  return <StaffLoginForm />;
}

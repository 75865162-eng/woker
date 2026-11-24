import { StaffLoginForm } from "@/components/auth/staff-login-form";

/**
 * Canonical internal staff sign-in route. Deliberately separated from the
 * public brand homepage at `/`. Uses the exact same credential flow as the
 * legacy /login route.
 */
export default function HkqLoginPage() {
  return <StaffLoginForm />;
}

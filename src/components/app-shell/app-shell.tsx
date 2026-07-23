import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShellClient } from "@/components/app-shell/app-shell-client";

export async function AppShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShellClient title={title} subtitle={subtitle} userInitials={getInitials(user.name || user.email)}>
      {children}
    </AppShellClient>
  );
}

function getInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "AM";
}

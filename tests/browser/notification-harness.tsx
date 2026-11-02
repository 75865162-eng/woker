import { createRoot } from "react-dom/client";
import { AppShellUserProvider } from "@/components/app-shell/app-shell-context";
import { UserNotificationCenter } from "@/components/notifications/user-notification-center";

createRoot(document.getElementById("root")!).render(
  <AppShellUserProvider value={{ organizationId: "org", userId: "user", userRole: "owner", userInitials: "U" }}>
    <UserNotificationCenter />
  </AppShellUserProvider>,
);

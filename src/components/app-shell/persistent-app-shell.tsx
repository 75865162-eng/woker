"use client";

import { createContext, useContext, useLayoutEffect, useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import { AppShellClient } from "./app-shell-client";

export type AppShellConfiguration = Omit<ComponentProps<typeof AppShellClient>, "children"> & {
  authorizationRevision?: string;
};

const ConfigurationContext = createContext<Dispatch<SetStateAction<AppShellConfiguration>> | null>(null);

export function PersistentAppShell({ children, initialConfiguration }: {
  children: React.ReactNode;
  initialConfiguration: AppShellConfiguration;
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  return (
    <ConfigurationContext.Provider value={setConfiguration}>
      <AppShellClient key={`${configuration.organizationId}:${configuration.userId}`} {...configuration}>{children}</AppShellClient>
    </ConfigurationContext.Provider>
  );
}

// Page authorization still runs on the server for every new page request.
// Only the display configuration changes; the sidebar, workspace and notification owners persist.
export function AppShellPage({ children, configuration }: {
  children: React.ReactNode;
  configuration: AppShellConfiguration;
}) {
  const setConfiguration = useContext(ConfigurationContext);
  if (!setConfiguration) throw new Error("Business pages must use the persistent ERP layout.");
  useLayoutEffect(() => { setConfiguration(configuration); }, [configuration, setConfiguration]);
  return children;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const tabs = [
  { id: "models", label: "模型与工具" },
  { id: "workspace", label: "工作区" },
  { id: "notifications", label: "通知" },
  { id: "integrations", label: "集成" },
  { id: "operations", label: "运维" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsTabs({
  modelContent,
  workspaceContent,
  notificationContent,
  integrationsContent,
  operationsContent,
}: {
  modelContent: ReactNode;
  workspaceContent: ReactNode;
  notificationContent: ReactNode;
  integrationsContent: ReactNode;
  operationsContent: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("models");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const syncTab = () => {
      const value = new URLSearchParams(window.location.search).get("tab");
      const requested = value === "integrations" || window.location.hash === "#amazon-sp-api" ? "integrations" : value;
      setActiveTab(tabs.some((tab) => tab.id === requested) ? (requested as TabId) : "models");
    };
    syncTab();
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);

  useEffect(() => {
    if (activeTab === "integrations" && window.location.hash === "#amazon-sp-api") {
      requestAnimationFrame(() => document.getElementById("amazon-sp-api")?.scrollIntoView({ block: "start" }));
    }
  }, [activeTab]);

  function selectTab(tab: TabId) {
    setActiveTab(tab);
    const query = tab === "models" ? "" : `?tab=${tab}`;
    const hash = tab === "integrations" ? "#amazon-sp-api" : "";
    router.replace(`${pathname}${query}${hash}`, { scroll: false });
  }

  const content: Record<TabId, ReactNode> = {
    models: modelContent,
    workspace: workspaceContent,
    notifications: notificationContent,
    integrations: integrationsContent,
    operations: operationsContent,
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="设置分类">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => selectTab(tab.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition ${
              activeTab === tab.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" key={activeTab}>
        {content[activeTab]}
      </div>
    </div>
  );
}

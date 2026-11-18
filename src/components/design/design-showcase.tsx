"use client";

import { useState } from "react";
import { Section, SectionBody } from "@/components/ui/section";

import { LegacyTablesShowcase } from "./design-showcase-legacytables";
import { TemplatesShowcase } from "./design-showcase-templates";
import { TablesShowcase } from "./design-showcase-tables";
import { NavigationShowcase } from "./design-showcase-navigation";
import { OverlaysShowcase } from "./design-showcase-overlays";
import { FeedbackShowcase } from "./design-showcase-feedback";
import { FormsShowcase } from "./design-showcase-forms";
import { ButtonsShowcase } from "./design-showcase-buttons";
import { SpacingShowcase } from "./design-showcase-spacing";
import { ColorsShowcase } from "./design-showcase-colors";
import { TypographyShowcase } from "./design-showcase-typography";
export function DesignShowcase() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "detail" | "history">("overview");
  const [segmented, setSegmented] = useState<"all" | "pending" | "done">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  return (
    <div className="flex flex-col gap-8">
      <Section>
        <SectionBody className="space-y-2">
          <p className="text-body text-foreground">
            本页是设计系统的验收基准。所有公共组件先在这里通过肉眼验收，才允许进入业务页面；
            <code className="mx-1 rounded-sm bg-surface-muted px-1 text-meta">npm run ui:guard</code>
            会拦住绕过组件的写法。
          </p>
          <p className="text-meta text-muted">
            轮廓：桌面优先，验收分辨率 1366×768 / 1440×900 / 1920×1080。壳层导航 224px（折叠 64px）、顶栏 48px、多标签栏 36px、页面留白 24px。
          </p>
        </SectionBody>
      </Section>

      {/* ------------------------------------------------------- 1 排版 */}
      <TypographyShowcase />

      {/* ------------------------------------------------------- 2 颜色 */}
      <ColorsShowcase />

      {/* --------------------------------------------- 3 间距/圆角/阴影 */}
      <SpacingShowcase />

      {/* ------------------------------------------------------- 5 按钮 */}
      <ButtonsShowcase />

      {/* ------------------------------------------------------- 6 表单 */}
      <FormsShowcase segmented={segmented} setSegmented={setSegmented} />

      {/* ------------------------------------------------------- 7 反馈 */}
      <FeedbackShowcase />

      {/* ------------------------------------------------------- 8 浮层 */}
      <OverlaysShowcase dialogOpen={dialogOpen} setDialogOpen={setDialogOpen} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} />

      {/* ------------------------------------------------- 9 导航与分页 */}
      <NavigationShowcase tab={tab} setTab={setTab} page={page} setPage={setPage} />

      {/* --------------------------------------------------- 10 六种表格 */}
      <TablesShowcase selected={selected} setSelected={setSelected} />

      {/* --------------------------------------------------- 11 六种模板 */}
      <TemplatesShowcase />

      {/* ---------------------------------------------- 12 遗留表格归化 */}
      <LegacyTablesShowcase />
    </div>
  );
}

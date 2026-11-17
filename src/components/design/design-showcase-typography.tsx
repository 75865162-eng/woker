"use client";

import { Section, SectionBody } from "@/components/ui/section";
import { Block } from "./design-showcase-model";
export function TypographyShowcase() { return (<Block title="1 · 排版尺度" note="六档字号，字重只有 400 / 600 两级">
        <Section>
          <SectionBody className="space-y-0">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
              <span className="text-display text-foreground">商品主档 · 1,284 个 SKU</span>
              <code className="shrink-0 text-meta text-muted">display 20/28/600</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-y border-border py-2">
              <span className="text-title text-foreground">采购单 PO-2026-0412</span>
              <code className="shrink-0 text-meta text-muted">title 18/26/600</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-section text-foreground">筛选结果 · 共 1,284 个商品</span>
              <code className="shrink-0 text-meta text-muted">section 15/20/600</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-body text-foreground">正文与表单项 13px，长时间阅读不疲劳，单屏可容纳更多行。</span>
              <code className="shrink-0 text-meta text-muted">body 13/20/400</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-table text-foreground">表格单元格 13px，数字列叠加 tabular-nums 纵向对齐</span>
              <code className="shrink-0 text-meta text-muted">table 13/20/400</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-border py-2">
              <span className="text-meta text-muted">辅助信息、表头、计数、时间戳统一 12px</span>
              <code className="shrink-0 text-meta text-muted">meta 12/16/400</code>
            </div>
            <div className="flex items-baseline justify-between gap-4 pt-2">
              <span className="text-micro text-muted">导航分组标签</span>
              <code className="shrink-0 text-meta text-muted">micro 11/16/600（仅此一处）</code>
            </div>
          </SectionBody>
        </Section>
      </Block>); }

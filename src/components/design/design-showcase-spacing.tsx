"use client";

import { Section, SectionBody, SectionHeader } from "@/components/ui/section";
import { Block, TokenRow } from "./design-showcase-model";
export function SpacingShowcase() { return (<Block title="3 · 间距 · 圆角 · 阴影 · 层级 · 动效" note="4px 基数">
        <div className="grid gap-4 lg:grid-cols-3">
          <Section>
            <SectionHeader title="间距" />
            <SectionBody className="space-y-0">
              {[
                ["--space-1", "4px"],
                ["--space-2", "8px"],
                ["--space-3", "12px"],
                ["--space-4", "16px"],
                ["--pad-card", "16px 卡片内距"],
                ["--pad-page", "24px 页面留白"],
                ["--gap-section", "16px 区块间距"],
              ].map(([name, value]) => (
                <TokenRow key={name} name={name} value={value} />
              ))}
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="圆角与阴影" />
            <SectionBody className="space-y-3">
              <div className="flex items-end gap-3">
                {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((cls) => (
                  <div key={cls} className="text-center">
                    <div className={`h-10 w-11 border border-border bg-surface ${cls}`} />
                    <code className="mt-1 block text-label text-muted">{cls.replace("rounded-", "")}</code>
                  </div>
                ))}
              </div>
              <div className="flex items-end gap-3">
                {["shadow-1", "shadow-2", "shadow-3", "shadow-pop"].map((cls) => (
                  <div key={cls} className="text-center">
                    <div className={`h-8 w-11 rounded-md border border-border bg-surface ${cls}`} />
                    <code className="mt-1 block text-label text-muted">{cls}</code>
                  </div>
                ))}
              </div>
              <p className="text-meta text-muted">平面内容一律用边框分层，阴影只给浮层。</p>
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="层级与动效" />
            <SectionBody className="space-y-0">
              {[
                ["--z-sticky", "10 表头 / 吸底"],
                ["--z-dropdown", "30 下拉 / 浮层"],
                ["--z-drawer", "40 抽屉"],
                ["--z-modal", "50 弹窗"],
                ["--z-toast", "60 全局提示"],
                ["--motion-fast", "120ms 悬停 / 聚焦"],
                ["--motion-base", "180ms 展开 / 切换"],
                ["--motion-slow", "260ms 抽屉 / 弹窗"],
              ].map(([name, value]) => (
                <TokenRow key={name} name={name} value={value} />
              ))}
            </SectionBody>
          </Section>
        </div>
      </Block>); }

"use client";

import { Section, SectionBody, SectionHeader } from "@/components/ui/section";
import { Block, TokenRow } from "./design-showcase-model";
export function ColorsShowcase() { return (<Block title="2 · 颜色令牌" note="语义命名，业务页不允许写裸色值">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="表面与文字" />
            <SectionBody className="space-y-0">
              {[
                ["bg-background", "页面底色 #f6f7f9"],
                ["bg-surface", "卡片 / 表格 #ffffff"],
                ["bg-surface-muted", "表头 / 悬停 #eef2f5"],
                ["bg-surface-sunken", "次级凹面 #f8fafb"],
                ["text-foreground", "主文字 #111827"],
                ["text-muted", "辅助文字 #667085"],
                ["border-border", "分隔线 #d9e0e7"],
                ["text-brand", "品牌 / 链接 #176b87"],
              ].map(([name, desc]) => (
                <TokenRow key={name} name={name} value={desc} />
              ))}
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="状态：浅底 + 墨色成对出现" />
            <SectionBody className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-md bg-success-soft px-2 py-1 text-meta text-success-ink">成功 / 已上架</span>
                <span className="rounded-md bg-warning-soft px-2 py-1 text-meta text-warning-ink">警告 / 待处理</span>
                <span className="rounded-md bg-danger-soft px-2 py-1 text-meta text-danger-ink">错误 / 已超时</span>
                <span className="rounded-md bg-info-soft px-2 py-1 text-meta text-info-ink">信息 / 进行中</span>
                <span className="rounded-md bg-surface-muted px-2 py-1 text-meta text-neutral-ink">中性 / 草稿</span>
              </div>
              <p className="text-meta text-muted">
                浅底只配墨色使用。把 <code>text-success</code> 直接放在浅底上对比度只有 3.4:1，不合格。
              </p>
            </SectionBody>
          </Section>
        </div>
      </Block>); }

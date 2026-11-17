"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Section, SectionBody, SectionHeader } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status-pill";
import { ErrorState, LoadingState } from "@/components/ui/page-chrome";
import { Block } from "./design-showcase-model";
export function FeedbackShowcase() { return (<Block title="7 · 状态与反馈" note="StatusPill / Badge / Alert / Empty / Loading / Error">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="状态药丸与徽标" />
            <SectionBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="success" dot>已上架</StatusPill>
                <StatusPill tone="info" dot>开发中</StatusPill>
                <StatusPill tone="warning" dot>选品待提交</StatusPill>
                <StatusPill tone="danger" dot>已超时</StatusPill>
                <StatusPill tone="neutral" dot>草稿</StatusPill>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">已同步</Badge>
                <Badge tone="warning">待补数据</Badge>
                <Badge tone="danger">同步失败</Badge>
                <Badge tone="info">NEEDS_DATA</Badge>
                <Badge>默认</Badge>
              </div>
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="提示条" />
            <SectionBody className="space-y-2">
              <Alert tone="info" title="数据来源" description="本页数据由同步中心于 06:00 拉取，缓存 4 小时。" />
              <Alert tone="warning" title="缺少必要数据" description="3 个 SKU 缺少采购价，补货建议无法计算。" />
              <Alert tone="danger" title="同步失败" description="Amazon Ads 报表拉取超时，可重试。" />
            </SectionBody>
          </Section>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="空状态" />
            <SectionBody>
              <EmptyState
                title="还没有采购计划"
                description="从补货建议生成，或手工新建一张采购计划。"
                action={
                  <Button size="sm">
                    <Plus aria-hidden className="h-3 w-3" />
                    新建采购计划
                  </Button>
                }
              />
            </SectionBody>
          </Section>
          <Section>
            <SectionHeader title="加载与错误" />
            <SectionBody className="space-y-3">
              <LoadingState rows={3} />
              <ErrorState message="拉取 Amazon 广告报表时上游返回 503，已自动重试 2 次。" onRetry={() => undefined} />
            </SectionBody>
          </Section>
        </div>
      </Block>); }

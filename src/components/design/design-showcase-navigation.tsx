"use client";

import { Button } from "@/components/ui/button";
import { Section, SectionBody } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status-pill";
import { Breadcrumb, PageHeader, Pagination, Tabs } from "@/components/ui/page-chrome";
import { Block } from "./design-showcase-model";
export function NavigationShowcase({ tab, setTab, page, setPage }: { tab: "overview" | "detail" | "history"; setTab: React.Dispatch<React.SetStateAction<"overview" | "detail" | "history">>; page: number; setPage: React.Dispatch<React.SetStateAction<number>> }) { return (<Block title="9 · 导航、标签页与分页">
        <Section>
          <SectionBody className="space-y-4">
            <div className="space-y-2">
              <Breadcrumb items={[{ label: "采购管理", href: "#" }, { label: "采购订单", href: "#" }, { label: "PO-2026-0412" }]} />
              <PageHeader
                title="采购单 PO-2026-0412"
                status={<StatusPill tone="warning" dot>待审核</StatusPill>}
                meta="创建于 2026-11-12 · 陈爱盈"
                secondaryActions={
                  <Button size="sm" variant="secondary">
                    打印
                  </Button>
                }
                actions={<Button size="sm">提交审核</Button>}
              />
            </div>
            <Tabs
              ariaLabel="详情分区"
              value={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "概览" },
                { key: "detail", label: "明细", count: 5 },
                { key: "history", label: "操作历史", count: 12 },
              ]}
            />
            <Pagination total={1284} page={page} pageSize={50} onPage={setPage} onPageSizeChange={() => undefined} />
          </SectionBody>
        </Section>
      </Block>); }

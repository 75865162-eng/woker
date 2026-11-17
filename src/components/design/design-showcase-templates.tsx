"use client";

import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Section, SectionBody } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { ToolbarField } from "@/components/ui/toolbar";
import { DatePicker, Field, FormGrid, Input, Select } from "@/components/ui/form-controls";
import { FilterBar, PageHeader, Pagination } from "@/components/ui/page-chrome";
import { ChartPanel, DetailGroup, DetailItem, FormPageTemplate, HealthIndicator, ListPageTemplate } from "@/components/templates/page-templates";
import { demoRows, demoColumns, kpiItems, Block } from "./design-showcase-model";
export function TemplatesShowcase() { return (<Block title="11 · 六种页面模板" note="ListPage / DetailPage / Workbench / Dashboard / FormPage / Console">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-meta text-muted">ListPage：页头 + KPI + 筛选（含已选条件）+ 表格 + 分页</p>
            <Section>
              <SectionBody>
                <ListPageTemplate
                  header={
                    <PageHeader
                      description="列表页不在页面内重复标题，壳层顶栏已经渲染页面名。"
                      secondaryActions={
                        <Button size="sm" variant="secondary">
                          <Download aria-hidden className="h-3 w-3" />
                          导出
                        </Button>
                      }
                      actions={
                        <Button size="sm">
                          <Plus aria-hidden className="h-3 w-3" />
                          新建
                        </Button>
                      }
                    />
                  }
                  stats={<StatStrip items={kpiItems.slice(0, 4)} />}
                  filters={
                    <FilterBar
                      resultSummary="已筛出 5 条"
                      activeFilters={[
                        { key: "site", label: "站点：US", onRemove: () => undefined },
                        { key: "status", label: "状态：开发中", onRemove: () => undefined },
                      ]}
                      onReset={() => undefined}
                    >
                      <ToolbarField label="站点">
                        <Select
                          defaultValue="US"
                          options={[
                            { value: "US", label: "美国" },
                            { value: "CA", label: "加拿大" },
                          ]}
                        />
                      </ToolbarField>
                    </FilterBar>
                  }
                  table={<DataTable ariaLabel="模板示例表格" columns={demoColumns} rows={demoRows.slice(0, 3)} getRowKey={(row) => row.id} />}
                  pagination={<Pagination total={1284} page={1} pageSize={50} onPage={() => undefined} />}
                />
              </SectionBody>
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section>
              <SectionBody>
                <p className="mb-2 text-meta text-muted">DetailPage 分组详情</p>
                <DetailGroup title="基础信息" columns={2}>
                  <DetailItem label="采购单号" value="PO-2026-0412" />
                  <DetailItem label="供应商" value="深圳市恒达包装有限公司" />
                  <DetailItem label="预计到仓" value="2026-11-20" hint="逾期 2 天将标记" />
                  <DetailItem label="结算方式" value="月结 30 天" />
                </DetailGroup>
              </SectionBody>
            </Section>
            <Section>
              <SectionBody>
                <p className="mb-2 text-meta text-muted">Workbench / Dashboard 图表容器</p>
                <ChartPanel title="近 14 日广告花费" description="示例占位，真实页面接入现有图表组件" height={180}>
                  <div className="flex h-full items-end gap-1.5">
                    {[38, 52, 44, 61, 58, 70, 66, 74, 62, 80, 72, 88, 78, 92].map((value, index) => (
                      <div key={index} className="flex-1 rounded-t-sm bg-brand/20" style={{ height: `${value}%` }} />
                    ))}
                  </div>
                </ChartPanel>
              </SectionBody>
            </Section>
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">FormPage：分组 + 未保存提醒 + 粘性保存条</p>
            <Section>
              <SectionBody>
                <FormPageTemplate
                  dirty
                  sticky={false}
                  onSave={() => undefined}
                  onCancel={() => undefined}
                  actions={
                    <Button size="sm" variant="ghost">
                      保存为草稿
                    </Button>
                  }
                >
                  <FormGrid columns={3}>
                    <Field label="单据编号">
                      <Input defaultValue="PO-2026-0412" disabled />
                    </Field>
                    <Field label="供应商" required>
                      <Select defaultValue="hd" options={[{ value: "hd", label: "深圳市恒达包装" }]} />
                    </Field>
                    <Field label="预计到仓">
                      <DatePicker />
                    </Field>
                  </FormGrid>
                </FormPageTemplate>
              </SectionBody>
            </Section>
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">Console：运行状态 + 成败统计 + 任务 + 新鲜度</p>
            <Section>
              <SectionBody className="space-y-3">
                <HealthIndicator
                  items={[
                    { key: "api", label: "同步服务", state: "ok", detail: "02:14 前正常" },
                    { key: "queue", label: "任务队列", state: "warn", detail: "积压 18" },
                    { key: "ads", label: "Ads 报表", state: "down", detail: "上游 503" },
                  ]}
                />
                <StatStrip
                  items={[
                    { key: "ok", label: "今日成功", value: "1,284", tone: "success" },
                    { key: "fail", label: "今日失败", value: "3", tone: "danger" },
                    { key: "fresh", label: "订单数据新鲜度", value: "18 分钟", tone: "success" },
                  ]}
                />
              </SectionBody>
            </Section>
          </div>
        </div>
      </Block>); }

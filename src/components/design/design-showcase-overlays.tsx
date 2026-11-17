"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, SectionBody } from "@/components/ui/section";
import { DatePicker, Field, FormGrid, Select } from "@/components/ui/form-controls";
import { Dialog, Drawer, Dropdown, Popover, Tooltip } from "@/components/ui/overlays";
import { DetailGroup, DetailItem } from "@/components/templates/page-templates";
import { Block } from "./design-showcase-model";
export function OverlaysShowcase({ dialogOpen, setDialogOpen, drawerOpen, setDrawerOpen }: { dialogOpen: boolean; setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>; drawerOpen: boolean; setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>> }) { return (<Block title="8 · 浮层" note="Tooltip / Popover / Dropdown / Dialog / Drawer">
        <Section>
          <SectionBody className="flex flex-wrap items-center gap-2">
            <Tooltip content="沿用最近一次同步的库存快照">
              <Button size="sm" variant="secondary">悬停看提示</Button>
            </Tooltip>
            <Popover trigger={<Button size="sm" variant="secondary">Popover</Button>} label="示例浮层">
              <div className="space-y-1 px-2 py-1.5 text-meta text-muted">
                <p className="text-body text-foreground">任意内容</p>
                <p>点击外部或按 Esc 关闭。</p>
              </div>
            </Popover>
            <Dropdown
              trigger={<Button size="sm" variant="secondary">操作菜单</Button>}
              header="批量操作"
              items={[
                { key: "export", label: "导出选中", icon: <Download aria-hidden className="h-3.5 w-3.5" /> },
                { key: "assign", label: "调整负责人", description: "需采购权限" },
                { key: "delete", label: "删除", danger: true, dividerBefore: true },
              ]}
            />
            <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
              打开弹窗
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDrawerOpen(true)}>
              打开抽屉
            </Button>
          </SectionBody>
        </Section>

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="新建采购计划"
          description="弹窗使用原生 dialog，焦点陷阱与焦点归还由浏览器负责。"
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={() => setDialogOpen(false)}>
                确认创建
              </Button>
            </>
          }
        >
          <FormGrid columns={2}>
            <Field label="供应商" htmlFor="dlg-supplier">
              <Select
                id="dlg-supplier"
                defaultValue="hd"
                options={[
                  { value: "hd", label: "深圳市恒达包装" },
                  { value: "cs", label: "东莞市昌盛家居" },
                ]}
              />
            </Field>
            <Field label="预计到仓" htmlFor="dlg-eta">
              <DatePicker id="dlg-eta" />
            </Field>
          </FormGrid>
        </Dialog>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="采购单 PO-2026-0412"
          description="右侧抽屉用于详情与编辑，不打断列表上下文。"
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setDrawerOpen(false)}>
                关闭
              </Button>
              <Button size="sm" onClick={() => setDrawerOpen(false)}>
                保存
              </Button>
            </>
          }
        >
          <DetailGroup title="基础信息" columns={2}>
            <DetailItem label="供应商" value="深圳市恒达包装有限公司" />
            <DetailItem label="预计到仓" value="2026-11-20" />
            <DetailItem label="结算方式" value="月结 30 天" />
            <DetailItem label="仓位" value="深圳仓" />
          </DetailGroup>
        </Drawer>
      </Block>); }

"use client";

import { Search } from "lucide-react";
import { Section, SectionBody } from "@/components/ui/section";
import { Checkbox, DatePicker, Field, FormGrid, Input, Radio, SegmentedControl, Select, Textarea } from "@/components/ui/form-controls";
import { Block } from "./design-showcase-model";
export function FormsShowcase({ segmented, setSegmented }: { segmented: "all" | "pending" | "done"; setSegmented: React.Dispatch<React.SetStateAction<"all" | "pending" | "done">> }) { return (<Block title="6 · 表单控件" note="高度走 --control-h，standard 档 36px">
        <Section>
          <SectionBody className="space-y-4">
            <FormGrid columns={3}>
              <Field label="SKU" required htmlFor="d-sku">
                <Input id="d-sku" placeholder="AMZ-0000" leading={<Search aria-hidden className="h-3.5 w-3.5" />} />
              </Field>
              <Field label="采购价" htmlFor="d-price" hint="含税，单位元">
                <Input id="d-price" defaultValue="32.80" numeric />
              </Field>
              <Field label="校验失败示例" htmlFor="d-err" error="该 SKU 已存在">
                <Input id="d-err" defaultValue="AMZ-0026" invalid />
              </Field>
              <Field label="站点" htmlFor="d-site">
                <Select
                  id="d-site"
                  defaultValue="US"
                  options={[
                    { value: "US", label: "美国 US" },
                    { value: "CA", label: "加拿大 CA" },
                    { value: "MX", label: "墨西哥 MX" },
                  ]}
                />
              </Field>
              <Field label="生效日期" htmlFor="d-date">
                <DatePicker id="d-date" defaultValue="2026-11-15" />
              </Field>
              <Field label="禁用" htmlFor="d-disabled">
                <Input id="d-disabled" defaultValue="只读字段" disabled />
              </Field>
            </FormGrid>
            <Field label="备注" htmlFor="d-note">
              <Textarea id="d-note" placeholder="供应商交期调整说明…" />
            </Field>
            <div className="flex flex-wrap gap-6">
              <Checkbox label="自动补货" description="库存低于安全库存时生成补货建议" defaultChecked />
              <Checkbox label="禁用项" disabled />
              <Radio name="d-radio" label="按 SKU 采购" defaultChecked />
              <Radio name="d-radio" label="按箱采购" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-meta text-muted">分段单选</span>
              <SegmentedControl
                ariaLabel="示例分段"
                value={segmented}
                onChange={setSegmented}
                options={[
                  { value: "all", label: "全部", count: 1284 },
                  { value: "pending", label: "待处理", count: 62 },
                  { value: "done", label: "已完成", count: 1222 },
                ]}
              />
            </div>
          </SectionBody>
        </Section>
      </Block>); }

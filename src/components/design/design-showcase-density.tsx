"use client";

import { Section, SectionBody } from "@/components/ui/section";
import { SegmentedControl } from "@/components/ui/form-controls";
import { DENSITY_HINTS, DENSITY_LABELS, DENSITY_ORDER, useDensityStore } from "@/lib/stores/density-store";
import { Block } from "./design-showcase-model";
export function DensityShowcase({ density, setDensity }: { density: ReturnType<typeof useDensityStore.getState>["density"]; setDensity: ReturnType<typeof useDensityStore.getState>["setDensity"] }) { return (<Block title="4 · 信息密度" note="真实改变行高、内距、控件高与字号，不是换按钮状态">
        <Section>
          <SectionBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                ariaLabel="信息密度"
                value={density}
                onChange={(value) => setDensity(value)}
                options={DENSITY_ORDER.map((item) => ({ value: item, label: DENSITY_LABELS[item] }))}
              />
              <span className="text-meta text-muted">
                当前：{DENSITY_LABELS[density]} · {DENSITY_HINTS[density]}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table>
                <thead>
                  <tr>
                    <th>档位</th>
                    <th>行高</th>
                    <th>单元格内距</th>
                    <th>控件高度</th>
                    <th>正文字号</th>
                    <th>适用</th>
                  </tr>
                </thead>
                <tbody>
                  {DENSITY_ORDER.map((item) => (
                    <tr key={item} className={item === density ? "bg-brand/5" : undefined}>
                      <td className="font-semibold">{DENSITY_LABELS[item]}</td>
                      <td className="metric-tabular">{item === "compact" ? "32px" : item === "standard" ? "40px" : "48px"}</td>
                      <td className="metric-tabular">
                        {item === "compact" ? "6 / 10" : item === "standard" ? "10 / 12" : "14 / 14"}
                      </td>
                      <td className="metric-tabular">{item === "compact" ? "32px" : item === "standard" ? "36px" : "40px"}</td>
                      <td className="metric-tabular">{item === "comfortable" ? "14px" : "13px"}</td>
                      <td className="text-muted">{DENSITY_HINTS[item]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-meta text-muted">
              偏好保存在 localStorage（键 <code>erp-density</code>），壳层顶栏也有入口。切换后本页下方所有表格立即跟随。
            </p>
          </SectionBody>
        </Section>
      </Block>); }

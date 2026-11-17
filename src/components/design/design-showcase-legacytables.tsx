"use client";

import { Section, SectionHeader } from "@/components/ui/section";
import { Block } from "./design-showcase-model";
export function LegacyTablesShowcase() { return (<Block title="12 · 遗留表格归化层" note="左：归化后（默认生效）；右：加 .erp-table-reset 豁免后的原始标记">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section>
            <SectionHeader title="归化后（默认生效）" description="表头浅底 + 12px 常规字重、行分隔线、悬停、吸顶、等宽数字" />
            <div>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>品名</th>
                    <th className="text-right">数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>AMZ-0026</td>
                    <td>折叠收纳箱 大号</td>
                    <td className="metric-tabular text-right">200</td>
                  </tr>
                  <tr>
                    <td>AMZ-0031</td>
                    <td>硅胶厨房垫 双面</td>
                    <td className="metric-tabular text-right">100</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
          <Section>
            <SectionHeader title="豁免后（原始标记）" description="同一份标记，去掉归化层后的样子；用来说明这层到底做了什么" />
            <div className="erp-table-reset">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>品名</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>AMZ-0026</td>
                    <td>折叠收纳箱 大号</td>
                    <td>200</td>
                  </tr>
                  <tr>
                    <td>AMZ-0031</td>
                    <td>硅胶厨房垫 双面</td>
                    <td>100</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </Block>); }

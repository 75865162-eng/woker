"use client";

import { DenseDataTable, EditableDataTable, FinanceDataTable, GroupedDataTable, StandardDataTable, TaskDataTable } from "@/components/ui/table-variants";
import { demoRows, demoColumns, financeRows, financeColumns, groupData, groupColumns, taskRows, taskColumns, editableColumns, sumAmounts, Block } from "./design-showcase-model";
export function TablesShowcase({ selected, setSelected }: { selected: ReadonlySet<string>; setSelected: React.Dispatch<React.SetStateAction<ReadonlySet<string>>> }) { return (<Block title="10 · 六种表格" note="同一内核，不同行组织结构；不要用同一种表硬套所有业务">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1 text-meta text-muted">StandardDataTable · 默认列表，带搜索与列显隐</p>
            <StandardDataTable
              ariaLabel="标准表格示例"
              title="筛选结果"
              meta="共 5 条"
              search={{ value: "", onChange: () => undefined, placeholder: "搜索 SKU / 品名" }}
              columnToggle
              pinnedColumnKeys={["sku"]}
              columns={demoColumns}
              rows={demoRows}
              getRowKey={(row) => row.id}
              selection={{
                selectedKeys: selected,
                onToggle: (key) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  }),
                onToggleAll: (checked) => setSelected(checked ? new Set(demoRows.map((row) => row.id)) : new Set()),
              }}
            />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">DenseDataTable · 32px 行高，适合库存、库龄、对账明细</p>
            <DenseDataTable ariaLabel="紧凑表格示例" columns={demoColumns} rows={demoRows} getRowKey={(row) => row.id} maxHeight="240px" />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">FinanceDataTable · 等宽数字 + 合计行，金额全程字符串</p>
            <FinanceDataTable
              ariaLabel="财务表格示例"
              title="凭证明细"
              columns={financeColumns}
              rows={financeRows}
              getRowKey={(row) => row.id}
              totalLabel="合计"
              totalColumns={[
                { key: "debit", compute: (rows) => sumAmounts(rows.map((row) => row.debit)) },
                { key: "credit", compute: (rows) => sumAmounts(rows.map((row) => row.credit)) },
              ]}
            />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">GroupedDataTable · 一行主体 + N 行明细，保留配对语义</p>
            <GroupedDataTable ariaLabel="分组表格示例" columns={groupColumns} groups={groupData} getRowKey={(row) => row.id} />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">EditableDataTable · 逐格编辑，Enter 提交、Esc 取消</p>
            <EditableDataTable
              ariaLabel="可编辑表格示例"
              title="库存盘点"
              columns={editableColumns}
              rows={demoRows}
              getRowKey={(row) => row.id}
            />
          </div>

          <div>
            <p className="mb-1 text-meta text-muted">TaskDataTable · 状态 + 进度，作业类页面</p>
            <TaskDataTable
              ariaLabel="任务表格示例"
              title="同步任务"
              columns={taskColumns}
              rows={taskRows}
              getRowKey={(row) => row.id}
              stateOf={(row) => row.state}
            />
          </div>
        </div>
      </Block>); }

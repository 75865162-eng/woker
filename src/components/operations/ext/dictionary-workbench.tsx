"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, extPost, useExt } from "./kit";

type Dictionary = { id: string; code: string; name: string; description: string; itemCount: number; revision: number; items: Array<{ id: string; value: string; label: string; sort: number; enabled: boolean }> };
type CustomField = { id: string; entity: string; code: string; label: string; fieldType: string; required: boolean; options: string[] | null; enabled: boolean; sortOrder: number; revision: number };

const entities = [{ value: "PRODUCT", label: "商品" }, { value: "SUPPLIER", label: "供应商" }, { value: "PURCHASE_ORDER", label: "采购单" }, { value: "ORDER", label: "订单" }];
const fieldTypes = [{ value: "TEXT", label: "文本" }, { value: "NUMBER", label: "数字" }, { value: "DATE", label: "日期" }, { value: "SELECT", label: "单选" }, { value: "BOOLEAN", label: "是/否" }];

const blankDict = { code: "", name: "", description: "" };
const blankItem = { dictionaryId: "", value: "", label: "", sort: "0" };
const blankField = { entity: "PRODUCT", code: "", label: "", fieldType: "TEXT", required: "false", options: "", sortOrder: "0" };

export function DictionaryWorkbench() {
  const [tab, setTab] = useState<"DICT" | "FIELD">("DICT");
  const [dict, setDict] = useState({ ...blankDict });
  const [editDictId, setEditDictId] = useState("");
  const [item, setItem] = useState({ ...blankItem });
  const [field, setField] = useState({ ...blankField });
  const [editFieldId, setEditFieldId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const dictionaries = useExt<{ items: Dictionary[] }>("dictionaries");
  const fields = useExt<{ items: CustomField[] }>("custom-fields");

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setNotice("");
    try { await extPost(action, body); setNotice(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  const selectedDict = dictionaries.data?.items.find(row => row.id === item.dictionaryId);
  const totalItems = (dictionaries.data?.items ?? []).reduce((sum, row) => sum + row.items.length, 0);

  return <div className="space-y-6">
    <Notice error={error || dictionaries.error || fields.error || ""} notice={notice} />
    <Kpis items={[
      { label: "字典数", value: String(dictionaries.data?.items.length ?? 0) },
      { label: "字典项", value: String(totalItems) },
      { label: "自定义字段", value: String(fields.data?.items.length ?? 0) },
      { label: "启用字段", value: String((fields.data?.items ?? []).filter(row => row.enabled).length) },
    ]} />
    <Tabs value={tab} onChange={value => setTab(value as "DICT" | "FIELD")} tabs={[{ id: "DICT", label: "数据字典", count: dictionaries.data?.items.length }, { id: "FIELD", label: "自定义字段", count: fields.data?.items.length }]} />

    {tab === "DICT" && <>
      <Section title={editDictId ? "编辑字典" : "新建字典"} description="把各页面散落的枚举收敛为可维护字典；编码在工作区内唯一，改编码等于新建。">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="字典编码" value={dict.code} onChange={value => setDict(c => ({ ...c, code: value.toUpperCase() }))} placeholder="SHIPMENT_STATUS" />
          <Field label="字典名称" value={dict.name} onChange={value => setDict(c => ({ ...c, name: value }))} placeholder="货件状态" />
          <Field label="说明" value={dict.description} onChange={value => setDict(c => ({ ...c, description: value }))} />
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={busy} onClick={() => void run("save-dictionary", { ...dict, ...(editDictId ? { id: editDictId, revision: dictionaries.data?.items.find(row => row.id === editDictId)?.revision } : {}) }, editDictId ? "字典已更新。" : "字典已创建。", async () => { setDict({ ...blankDict }); setEditDictId(""); await dictionaries.reload(); })}>{editDictId ? "保存修改" : "新建字典"}</Button>
            {editDictId && <Button size="sm" variant="ghost" onClick={() => { setEditDictId(""); setDict({ ...blankDict }); }}>取消</Button>}
          </div>
        </div>
      </Section>

      <Section title="字典项维护" description="先选字典，再维护字典项；同一字典内值唯一，重复保存等于更新显示名。">
        <div className="grid gap-2 sm:grid-cols-4">
          <SelectField label="字典" value={item.dictionaryId} onChange={value => setItem(c => ({ ...c, dictionaryId: value }))} placeholder="选择字典" options={(dictionaries.data?.items ?? []).map(row => ({ value: row.id, label: `${row.code} · ${row.name}` }))} />
          <Field label="值" value={item.value} onChange={value => setItem(c => ({ ...c, value: value }))} />
          <Field label="显示名" value={item.label} onChange={value => setItem(c => ({ ...c, label: value }))} />
          <div className="flex items-end gap-2">
            <Field label="排序" value={item.sort} onChange={value => setItem(c => ({ ...c, sort: value }))} />
            <Button size="sm" disabled={busy || !item.dictionaryId} onClick={() => void run("save-dictionary-item", { ...item, sort: Number(item.sort || 0) }, "字典项已保存。", dictionaries.reload)}>保存项</Button>
          </div>
        </div>
        {selectedDict && <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-muted"><tr>{["值", "显示名", "排序", "状态", "操作"].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead>
            <tbody>{selectedDict.items.length ? selectedDict.items.map(row => <tr key={row.id} className="border-t border-border">
              <td className="py-1.5 font-mono">{row.value}</td>
              <td>{row.label}</td>
              <td className="tabular-nums">{row.sort}</td>
              <td><Badge text={row.enabled ? "启用" : "停用"} tone={row.enabled ? "good" : "muted"} /></td>
              <td className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setItem({ dictionaryId: selectedDict.id, value: row.value, label: row.label, sort: String(row.sort) })}>编辑</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("delete-dictionary-item", { id: row.id }, "字典项已删除。", dictionaries.reload)}>删除</Button>
              </td>
            </tr>) : <tr><td colSpan={5} className="py-3 text-center text-muted">该字典还没有字典项。</td></tr>}</tbody>
          </table>
        </div>}
      </Section>

      <Section title="字典清单">
        <Table
          rows={dictionaries.data?.items ?? []}
          empty="还没有数据字典。"
          columns={[
            { key: "code", label: "编码", render: row => <span className="font-mono">{row.code}</span> },
            { key: "name", label: "名称" },
            { key: "description", label: "说明", render: row => row.description || "—" },
            { key: "itemCount", label: "项数", align: "right", render: row => String(row.items.length) },
            { key: "ops", label: "操作", render: row => <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setEditDictId(row.id); setDict({ code: row.code, name: row.name, description: row.description }); }}>编辑</Button>
              <Button size="sm" variant="ghost" onClick={() => setItem(current => ({ ...current, dictionaryId: row.id }))}>维护项</Button>
            </div> },
          ]}
        />
      </Section>
    </>}

    {tab === "FIELD" && <>
      <Section title={editFieldId ? "编辑自定义字段" : "新建自定义字段"} description="字段定义登记在字典层；值仍存在各业务表自身的扩展 JSON 里，这里不做双写。">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SelectField label="目标实体" value={field.entity} onChange={value => setField(c => ({ ...c, entity: value }))} options={entities} />
          <Field label="字段编码" value={field.code} onChange={value => setField(c => ({ ...c, code: value }))} placeholder="custom_origin" />
          <Field label="字段名称" value={field.label} onChange={value => setField(c => ({ ...c, label: value }))} placeholder="原产国" />
          <SelectField label="字段类型" value={field.fieldType} onChange={value => setField(c => ({ ...c, fieldType: value }))} options={fieldTypes} />
          <SelectField label="是否必填" value={field.required} onChange={value => setField(c => ({ ...c, required: value }))} options={[{ value: "false", label: "选填" }, { value: "true", label: "必填" }]} />
          <Field label="排序" value={field.sortOrder} onChange={value => setField(c => ({ ...c, sortOrder: value }))} />
          <Field label="选项（逗号分隔，仅单选需要）" value={field.options} onChange={value => setField(c => ({ ...c, options: value }))} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run("save-custom-field", {
            ...field, required: field.required === "true", sortOrder: Number(field.sortOrder || 0),
            options: field.options ? field.options.split(",").map(item => item.trim()).filter(Boolean) : [],
            ...(editFieldId ? { id: editFieldId, revision: fields.data?.items.find(row => row.id === editFieldId)?.revision } : {}),
          }, editFieldId ? "字段已更新。" : "字段已创建。", async () => { setField({ ...blankField }); setEditFieldId(""); await fields.reload(); })}>{editFieldId ? "保存修改" : "新建字段"}</Button>
          {editFieldId && <Button size="sm" variant="ghost" onClick={() => { setEditFieldId(""); setField({ ...blankField }); }}>取消</Button>}
        </div>
      </Section>

      <Section title="字段清单">
        <Table
          rows={fields.data?.items ?? []}
          empty="还没有自定义字段。"
          columns={[
            { key: "entity", label: "实体", render: row => entities.find(item => item.value === row.entity)?.label ?? row.entity },
            { key: "code", label: "编码", render: row => <span className="font-mono">{row.code}</span> },
            { key: "label", label: "名称" },
            { key: "fieldType", label: "类型", render: row => fieldTypes.find(item => item.value === row.fieldType)?.label ?? row.fieldType },
            { key: "required", label: "必填", render: row => row.required ? "是" : "否" },
            { key: "enabled", label: "状态", render: row => <Badge text={row.enabled ? "启用" : "停用"} tone={row.enabled ? "good" : "muted"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditFieldId(row.id);
              setField({
                entity: row.entity, code: row.code, label: row.label, fieldType: row.fieldType,
                required: row.required ? "true" : "false", sortOrder: String(row.sortOrder),
                options: Array.isArray(row.options) ? row.options.join(",") : "",
              });
            }}>编辑</Button> },
          ]}
        />
      </Section>
    </>}
  </div>;
}

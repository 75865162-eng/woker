"use client";

import { useState } from "react";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import { AreaField, Badge, Field, Kpis, Notice, Section, SelectField, Table, Tabs, extPost, statusLabel, useExt } from "./kit";

type Department = { id: string; code: string; name: string; parentId: string | null; leader: string; sortOrder: number; enabled: boolean; revision: number };
type Announcement = { id: string; title: string; body: string; audience: string; audienceValue: string; pinned: boolean; status: string; publishedAt: string | null; revision: number };
type PersonalNote = { id: string; title: string; content: string; pinned: boolean; revision: number };
type OnlineSession = { id: string; userId: string; name: string; email: string; role: string; expiresAt: string; createdAt: string };

const blankDept = { code: "", name: "", parentId: "", leader: "", sortOrder: "0" };
const blankNotice = { title: "", body: "", audience: "ALL", audienceValue: "", pinned: "false", status: "DRAFT" };
const blankNote = { title: "", content: "", pinned: "false" };

export function SystemAdminWorkbench() {
  const [tab, setTab] = useState<"DEPT" | "NOTICE" | "NOTE" | "ONLINE">("DEPT");
  const [dept, setDept] = useState({ ...blankDept });
  const [editDeptId, setEditDeptId] = useState("");
  const [notice, setNoticeForm] = useState({ ...blankNotice });
  const [editNoticeId, setEditNoticeId] = useState("");
  const [note, setNote] = useState({ ...blankNote });
  const [editNoteId, setEditNoteId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const departments = useExt<{ items: Department[] }>("departments");
  const announcements = useExt<{ items: Announcement[] }>("announcements");
  const notes = useExt<{ items: PersonalNote[] }>("personal-notes");
  const sessions = useExt<{ items: OnlineSession[]; activeUsers: number }>("online-sessions");

  async function run(action: string, body: Record<string, unknown>, message: string, after: () => Promise<void> | void) {
    setBusy(true); setError(""); setSuccess("");
    try { await extPost(action, body); setSuccess(message); await after(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  const deptName = (id: string) => departments.data?.items.find(row => row.id === id)?.name ?? "—";

  return <WorkbenchPageTemplate
    context={<Notice error={error || departments.error || announcements.error || notes.error || sessions.error || ""} notice={success} />}
    kpis={<Kpis items={[
      { label: "部门数", value: String(departments.data?.items.length ?? 0) },
      { label: "已发布公告", value: String((announcements.data?.items ?? []).filter(row => row.status === "PUBLISHED").length) },
      { label: "我的记事", value: String(notes.data?.items.length ?? 0) },
      { label: "在线用户", value: String(sessions.data?.activeUsers ?? 0), hint: <span>有效会话 {sessions.data?.items.length ?? 0}</span> },
    ]} />}
    main={<div className="space-y-5">
      <Tabs value={tab} onChange={value => setTab(value as typeof tab)} tabs={[
        { id: "DEPT", label: "部门管理", count: departments.data?.items.length },
        { id: "NOTICE", label: "公告发布", count: announcements.data?.items.length },
        { id: "NOTE", label: "我的记事本", count: notes.data?.items.length },
        { id: "ONLINE", label: "在线用户", count: sessions.data?.items.length },
      ]} />

      {tab === "DEPT" && <>
        <Section title={editDeptId ? "编辑部门" : "新建部门"} description="树形部门主数据；上级决定层级，改编码等于新建。成员表按名称软关联，不反向覆盖花名册。">
          <div className="grid gap-2 sm:grid-cols-5">
            <Field label="部门编码" value={dept.code} onChange={value => setDept(c => ({ ...c, code: value.toUpperCase() }))} placeholder="OPERATIONS" />
            <Field label="部门名称" value={dept.name} onChange={value => setDept(c => ({ ...c, name: value }))} placeholder="运营部" />
            <SelectField label="上级部门" value={dept.parentId} onChange={value => setDept(c => ({ ...c, parentId: value }))} placeholder="无（顶级）" options={(departments.data?.items ?? []).filter(row => row.id !== editDeptId).map(row => ({ value: row.id, label: row.name }))} />
            <Field label="负责人" value={dept.leader} onChange={value => setDept(c => ({ ...c, leader: value }))} />
            <div className="flex items-end gap-2">
              <Field label="排序" value={dept.sortOrder} onChange={value => setDept(c => ({ ...c, sortOrder: value }))} />
              <Button size="sm" disabled={busy} onClick={() => void run("save-department", {
                ...dept, parentId: dept.parentId || null, sortOrder: Number(dept.sortOrder || 0),
                ...(editDeptId ? { id: editDeptId, revision: departments.data?.items.find(row => row.id === editDeptId)?.revision } : {}),
              }, editDeptId ? "部门已更新。" : "部门已创建。", async () => { setDept({ ...blankDept }); setEditDeptId(""); await departments.reload(); })}>{editDeptId ? "保存" : "新建"}</Button>
              {editDeptId && <Button size="sm" variant="ghost" onClick={() => { setEditDeptId(""); setDept({ ...blankDept }); }}>取消</Button>}
            </div>
          </div>
        </Section>
        <Section title="部门清单">
          <Table rows={departments.data?.items ?? []} empty="还没有部门。" columns={[
            { key: "code", label: "编码", render: row => <span className="font-mono">{row.code}</span> },
            { key: "name", label: "名称" },
            { key: "parentId", label: "上级", render: row => deptName(row.parentId ?? "") },
            { key: "leader", label: "负责人", render: row => row.leader || "—" },
            { key: "sortOrder", label: "排序", align: "right" },
            { key: "enabled", label: "状态", render: row => <Badge text={row.enabled ? "启用" : "停用"} tone={row.enabled ? "good" : "muted"} /> },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditDeptId(row.id);
              setDept({ code: row.code, name: row.name, parentId: row.parentId ?? "", leader: row.leader, sortOrder: String(row.sortOrder) });
            }}>编辑</Button> },
          ]} />
        </Section>
      </>}

      {tab === "NOTICE" && <>
        <Section title={editNoticeId ? "编辑公告" : "发布公告"} description="全员公告会投递到每个人的通知中心（幂等，重复发布不重复打扰）；定向范围仅登记，不做臆造的成员映射。">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="标题" value={notice.title} onChange={value => setNoticeForm(c => ({ ...c, title: value }))} placeholder="国庆放假安排" />
            <SelectField label="发布范围" value={notice.audience} onChange={value => setNoticeForm(c => ({ ...c, audience: value }))} options={[{ value: "ALL", label: "全员" }, { value: "ROLE", label: "按角色" }, { value: "DEPARTMENT", label: "按部门" }]} />
            <Field label="范围值（角色/部门）" value={notice.audienceValue} onChange={value => setNoticeForm(c => ({ ...c, audienceValue: value }))} placeholder="全员可留空" />
            <SelectField label="状态" value={notice.status} onChange={value => setNoticeForm(c => ({ ...c, status: value }))} options={[{ value: "DRAFT", label: "草稿" }, { value: "PUBLISHED", label: "发布" }, { value: "ARCHIVED", label: "归档" }]} />
            <SelectField label="置顶" value={notice.pinned} onChange={value => setNoticeForm(c => ({ ...c, pinned: value }))} options={[{ value: "false", label: "否" }, { value: "true", label: "是" }]} />
            <div className="flex items-end">
              <Button size="sm" disabled={busy} onClick={() => void run("save-announcement", {
                ...notice, pinned: notice.pinned === "true",
                ...(editNoticeId ? { id: editNoticeId, revision: announcements.data?.items.find(row => row.id === editNoticeId)?.revision } : {}),
              }, editNoticeId ? "公告已更新。" : "公告已保存。", async () => { setNoticeForm({ ...blankNotice }); setEditNoticeId(""); await announcements.reload(); })}>{editNoticeId ? "保存" : "发布/保存"}</Button>
            </div>
          </div>
          <AreaField label="正文" value={notice.body} onChange={value => setNoticeForm(c => ({ ...c, body: value }))} placeholder="公告正文…" />
          {editNoticeId && <Button size="sm" variant="ghost" onClick={() => { setEditNoticeId(""); setNoticeForm({ ...blankNotice }); }}>取消编辑</Button>}
        </Section>
        <Section title="公告清单">
          <Table rows={announcements.data?.items ?? []} empty="还没有公告。" columns={[
            { key: "title", label: "标题" },
            { key: "audience", label: "范围", render: row => `${row.audience}${row.audienceValue ? ` · ${row.audienceValue}` : ""}` },
            { key: "pinned", label: "置顶", render: row => row.pinned ? "是" : "—" },
            { key: "status", label: "状态", render: row => <Badge text={statusLabel(row.status)} tone={row.status === "PUBLISHED" ? "good" : row.status === "ARCHIVED" ? "muted" : "info"} /> },
            { key: "publishedAt", label: "发布时间", render: row => row.publishedAt?.slice(0, 10) ?? "—" },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" onClick={() => {
              setEditNoticeId(row.id);
              setNoticeForm({ title: row.title, body: row.body, audience: row.audience, audienceValue: row.audienceValue, pinned: row.pinned ? "true" : "false", status: row.status });
            }}>编辑</Button> },
          ]} />
        </Section>
      </>}

      {tab === "NOTE" && <>
        <Section title={editNoteId ? "编辑记事" : "新建记事"} description="仅本人可见，按用户硬隔离；置顶记事排在前面。">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="标题" value={note.title} onChange={value => setNote(c => ({ ...c, title: value }))} placeholder="待办 / 灵感" />
            <SelectField label="置顶" value={note.pinned} onChange={value => setNote(c => ({ ...c, pinned: value }))} options={[{ value: "false", label: "否" }, { value: "true", label: "是" }]} />
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={busy} onClick={() => void run("save-personal-note", {
                ...note, pinned: note.pinned === "true",
                ...(editNoteId ? { id: editNoteId, revision: notes.data?.items.find(row => row.id === editNoteId)?.revision } : {}),
              }, editNoteId ? "记事已更新。" : "记事已保存。", async () => { setNote({ ...blankNote }); setEditNoteId(""); await notes.reload(); })}>{editNoteId ? "保存" : "新建"}</Button>
              {editNoteId && <Button size="sm" variant="ghost" onClick={() => { setEditNoteId(""); setNote({ ...blankNote }); }}>取消</Button>}
            </div>
          </div>
          <AreaField label="内容" value={note.content} onChange={value => setNote(c => ({ ...c, content: value }))} placeholder="记点什么…" />
        </Section>
        <Section title="我的记事">
          <Table rows={notes.data?.items ?? []} empty="还没有记事。" columns={[
            { key: "pinned", label: "", render: row => row.pinned ? <Badge text="置顶" tone="info" /> : null },
            { key: "title", label: "标题", render: row => row.title || "（无标题）" },
            { key: "content", label: "内容", render: row => <span className="line-clamp-1">{row.content || "—"}</span> },
            { key: "ops", label: "操作", render: row => <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setEditNoteId(row.id); setNote({ title: row.title, content: row.content, pinned: row.pinned ? "true" : "false" }); }}>编辑</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("delete-personal-note", { id: row.id }, "记事已删除。", notes.reload)}>删除</Button>
            </div> },
          ]} />
        </Section>
      </>}

      {tab === "ONLINE" && <>
        <Section title="在线用户监控" description="仅显示当前组织内有效会话（未过期）；强制下线会删除该用户的会话令牌，需审批权限。">
          <Table rows={sessions.data?.items ?? []} empty="当前没有在线会话。" columns={[
            { key: "name", label: "用户", render: row => row.name || row.email },
            { key: "email", label: "邮箱" },
            { key: "role", label: "角色", render: row => row.role || "—" },
            { key: "createdAt", label: "登录时间", render: row => row.createdAt.slice(0, 16).replace("T", " ") },
            { key: "expiresAt", label: "会话过期", render: row => row.expiresAt.slice(0, 16).replace("T", " ") },
            { key: "ops", label: "操作", render: row => <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("revoke-session", { id: row.id }, "已强制下线。", sessions.reload)}>强制下线</Button> },
          ]} />
        </Section>
      </>}
    </div>} />;
}

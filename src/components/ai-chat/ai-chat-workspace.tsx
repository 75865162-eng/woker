"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Database, Loader2, MessageSquarePlus, PanelRightClose, PanelRightOpen, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workspaceScopeHeaders } from "@/lib/workspace/workspace-scope-store";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import styles from "./ai-chat.module.css";

type Skill = { slug: string; name: string; summary: string; prompt: string };
type Conv = { id: string; title: string; revision: number; updatedAt: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; skillSlug?: string; createdAt: string; answer?: ChatAnswerData };
type ToolEvidence = { seq: number; provider: string; tool: string; argsSummary: string; resultSource?: string; rowCount?: number; status: "ok" | "error"; errorCode?: string; durationMs: number };
type ProviderStatus = { provider: string; status: string; toolCount: number; reason?: string };
type DataSourceStatus = { provider: string; label: string; configured: boolean; credentialName: string | null; toolCount: number; scopeSummary: string; readOnly: boolean };
type DataSourceSnapshot = { sources: DataSourceStatus[]; enabledProviders: string[]; confirmedAt: string | null; ready: boolean };
type ChatAnswerData = {
  text: string; runId: string; model: string;
  tools: ToolEvidence[]; providers: ProviderStatus[]; coverage: string[]; skipped: string[];
  skill?: { slug: string; hash: string; name: string; availability: string };
};

function shortTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AiChatWorkspace({ initialSkillSlug, skills, canCreate, locale }: { initialSkillSlug?: string; skills: Skill[]; canCreate: boolean; locale: string }) {
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [skillSlug, setSkillSlug] = useState<string>(initialSkillSlug ?? "");
  const [skillFilter, setSkillFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rightOpen, setRightOpen] = useState(true);
  const [lastAnswer, setLastAnswer] = useState<ChatAnswerData | null>(null);
  const [dataSources, setDataSources] = useState<DataSourceSnapshot | null>(null);
  const [dsSelected, setDsSelected] = useState<string[]>([]);
  const [dsOpen, setDsOpen] = useState(true);
  const [dsLoading, setDsLoading] = useState(false);
  const [dsSaving, setDsSaving] = useState(false);
  const [dsError, setDsError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRunRef = useRef<string>("");
  const mountedRef = useRef(true);

  const headers = useCallback(() => workspaceScopeHeaders(true), []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/chat/conversations", { headers: headers(), cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { conversations: Conv[] };
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
    } catch { /* 忽略，保留空列表 */ }
  }, [headers]);

  const loadDataSources = useCallback(async () => {
    setDsLoading(true);
    setDsError("");
    try {
      const res = await fetch("/api/ai/chat/data-sources", { headers: headers(), cache: "no-store" });
      if (!res.ok) throw new Error("读取数据源失败。");
      const data = await res.json() as DataSourceSnapshot;
      setDataSources(data);
      setDsSelected(data.enabledProviders ?? []);
    } catch {
      setDsError("读取数据源配置失败，请刷新重试。");
    } finally {
      setDsLoading(false);
    }
  }, [headers]);

  const saveDataSources = useCallback(async () => {
    if (!dataSources) return;
    setDsSaving(true);
    setDsError("");
    try {
      const res = await fetch("/api/ai/chat/data-sources", {
        method: "PUT", headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabledProviders: dsSelected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "保存失败。");
      }
      const data = await res.json() as DataSourceSnapshot;
      setDataSources(data);
      setDsSelected(data.enabledProviders ?? []);
      if (data.ready) setDsOpen(false);
    } catch (error) {
      setDsError(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setDsSaving(false);
    }
  }, [dataSources, dsSelected, headers]);

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setError("");
    setLastAnswer(null);
    try {
      const res = await fetch(`/api/ai/chat/conversations/${encodeURIComponent(id)}`, { headers: headers(), cache: "no-store" });
      if (!res.ok) { setError("无法读取该会话。"); return; }
      const data = await res.json() as { messages: Msg[] };
      const list = Array.isArray(data.messages) ? data.messages : [];
      setMessages(list.map(m => ({ ...m, role: m.role === "assistant" ? "assistant" : "user" })));
      const lastAssistant = [...list].reverse().find(m => m.role === "assistant");
      if (lastAssistant) setLastAnswer(null);
    } catch { setError("无法读取该会话。"); }
  }, [headers]);

  // 选中技能：同步技能状态并把该技能的 prompt 自动填入输入框，方便直接发送或继续编辑。
  const applySkill = useCallback((slug: string) => {
    setSkillSlug(slug);
    if (!slug) return;
    const picked = skills.find(s => s.slug === slug);
    if (picked?.prompt) {
      setDraft(picked.prompt);
      textareaRef.current?.focus();
    }
  }, [skills]);

  useEffect(() => {
    mountedRef.current = true;
    void loadConversations();
    void loadDataSources();
    if (initialSkillSlug) {
      setSkillSlug(initialSkillSlug);
      const picked = skills.find(s => s.slug === initialSkillSlug);
      if (picked?.prompt) setDraft(picked.prompt);
    }
    return () => { mountedRef.current = false; };
  }, [loadConversations, loadDataSources, initialSkillSlug, skills]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, statusText]);

  const newConversation = useCallback(async () => {
    if (!canCreate) return;
    try {
      const res = await fetch("/api/ai/chat/conversations", { method: "POST", headers: headers(), body: JSON.stringify({ title: "新对话" }) });
      if (!res.ok) { setError("创建会话失败。"); return; }
      const data = await res.json() as { conversation: Conv };
      setConversations(prev => [data.conversation, ...prev]);
      setActiveId(data.conversation.id);
      setMessages([]);
      setLastAnswer(null);
      setError("");
    } catch { setError("创建会话失败。"); }
  }, [canCreate, headers]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/ai/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
      if (!res.ok) return;
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeId === id) { setActiveId(""); setMessages([]); setLastAnswer(null); }
    } catch { /* ignore */ }
  }, [activeId, headers]);

  const send = useCallback(async () => {
    const question = draft.trim();
    if (!question || loading || !canCreate) return;
    if (!dataSources?.ready) {
      setDsOpen(true);
      setError("请先确认启用至少一个可用的 MCP 数据源，再开始分析。");
      return;
    }
    let convId = activeId;
    if (!convId) {
      const res = await fetch("/api/ai/chat/conversations", { method: "POST", headers: headers(), body: JSON.stringify({ title: question.slice(0, 24) }) });
      if (!res.ok) { setError("创建会话失败。"); return; }
      const data = await res.json() as { conversation: Conv };
      convId = data.conversation.id;
      setConversations(prev => [data.conversation, ...prev]);
      setActiveId(convId);
    }
    const clientKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const userMsg: Msg = { id: `u-${clientKey}`, role: "user", content: question, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setDraft("");
    setError("");
    setLoading(true);
    setStatusText("理解问题 / 检查技能与权限");
    activeRunRef.current = "";

    try {
      const res = await fetch(`/api/ai/chat/conversations/${encodeURIComponent(convId)}/messages`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ content: question, clientKey, idempotencyKey: clientKey, skillSlug: skillSlug || undefined }),
      });
      const data = await res.json() as { answer?: ChatAnswerData; error?: string; code?: string };
      if (!res.ok || !data.answer) {
        if (data.code === "CANCELLED") setError("已取消本次分析。");
        else setError(data.error || "分析失败，请重试。");
        setMessages(prev => [...prev, { id: `e-${clientKey}`, role: "assistant", content: `⚠️ ${data.error || "分析失败，请重试。"}`, createdAt: new Date().toISOString() }]);
        return;
      }
      const answer = data.answer;
      activeRunRef.current = answer.runId;
      setMessages(prev => [...prev, { id: `a-${clientKey}`, role: "assistant", content: answer.text, skillSlug: answer.skill?.slug, createdAt: new Date().toISOString(), answer }]);
      setLastAnswer(answer);
      void loadConversations();
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }, [draft, loading, canCreate, activeId, headers, skillSlug, loadConversations, dataSources]);

  const cancel = useCallback(async () => {
    if (!activeRunRef.current || !activeId) return;
    try {
      await fetch(`/api/ai/chat/conversations/${encodeURIComponent(activeId)}/runs/${encodeURIComponent(activeRunRef.current)}/cancel`, { method: "POST", headers: headers() });
    } catch { /* ignore */ }
  }, [activeId, headers]);

  const onWorkspaceChanged = useCallback(() => {
    // 工作区切换即停止当前请求并清空上下文，避免迟到结果串到新工作区。
    if (loading) void cancel();
    setMessages([]);
    setLastAnswer(null);
    setActiveId("");
    setError("");
    void loadConversations();
    void loadDataSources();
  }, [loading, cancel, loadConversations, loadDataSources]);

  useEffect(() => {
    window.addEventListener(workspaceScopeChangedEventName, onWorkspaceChanged as EventListener);
    return () => window.removeEventListener(workspaceScopeChangedEventName, onWorkspaceChanged as EventListener);
  }, [onWorkspaceChanged]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? conversations.filter(c => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, search]);
  const filteredSkills = useMemo(() => {
    const q = skillFilter.trim().toLowerCase();
    return q ? skills.filter(s => `${s.slug} ${s.name}`.toLowerCase().includes(q)).slice(0, 40) : skills.slice(0, 40);
  }, [skills, skillFilter]);
  const selectedSkill = skills.find(s => s.slug === skillSlug);

  return (
    <div className={`${styles.workspace} ${rightOpen ? "" : styles.noRight}`}>
      <aside className={styles.left}>
        <div className={styles.leftHead}>
          <Button size="sm" variant="secondary" onClick={() => void newConversation()} disabled={!canCreate}>
            <MessageSquarePlus size={15} /> 新建对话
          </Button>
        </div>
        <div className={styles.search}>
          <Search size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索会话" aria-label="搜索会话" />
        </div>
        <div className={styles.convList} role="list">
          {filteredConversations.length === 0 && <div className={styles.emptyHint}>暂无会话</div>}
          {filteredConversations.map(c => (
            <div key={c.id} className={`${styles.convItem} ${c.id === activeId ? styles.convActive : ""}`} role="listitem">
              <button className={styles.convMain} onClick={() => void loadConversation(c.id)}>
                <span className={styles.convTitle}>{c.title || "新对话"}</span>
                <span className={styles.convTime}>{shortTime(c.updatedAt)}</span>
              </button>
              <button className={styles.iconBtn} aria-label="删除会话" title="删除会话" onClick={() => void deleteConversation(c.id)} disabled={!canCreate}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </aside>

      <main className={styles.center}>
        <div className={styles.centerHead}>
          <div className={styles.centerTitle}>{selectedSkill ? <><Sparkles size={16} /> {selectedSkill.name}</> : <><Bot size={16} /> 经营分析助手</>}</div>
          <button className={styles.iconBtn} onClick={() => setRightOpen(v => !v)} aria-label="切换分析面板" title="切换分析面板">
            {rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>

        <div className={styles.dsPanel}>
          <button className={styles.dsHead} onClick={() => setDsOpen(v => !v)} aria-expanded={dsOpen}>
            <span className={styles.dsHeadTitle}>
              <Database size={15} />
              数据源 / MCP 配置
              {dataSources?.ready ? (
                <Badge tone="success">已启用 {dataSources.enabledProviders.length} 个</Badge>
              ) : (
                <Badge tone="warning">未配置</Badge>
              )}
            </span>
            <span className={styles.dsHeadHint}>先确认可读取的数据源，模型才能基于其返回的数据分析</span>
            {dsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          {dsOpen && (
            <div className={styles.dsBody}>
              {dsLoading && <p className={styles.muted}>正在检查当前账号的 MCP 凭证…</p>}
              {!dsLoading && dataSources && (
                <>
                  {dataSources.sources.map(src => {
                    const checked = dsSelected.includes(src.provider);
                    return (
                      <label key={src.provider} className={`${styles.dsSource} ${!src.configured ? styles.dsSourceDisabled : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!src.configured || dsSaving}
                          onChange={() => setDsSelected(prev => checked ? prev.filter(p => p !== src.provider) : [...prev, src.provider])}
                        />
                        <span className={styles.dsSourceMain}>
                          <span className={styles.dsSourceTop}>
                            <strong>{src.label}</strong>
                            {src.configured ? <Badge tone="success"><ShieldCheck size={11} /> 只读已授权</Badge> : <Badge tone="danger">未配置</Badge>}
                          </span>
                          <span className={styles.dsSourceMeta}>
                            {src.configured ? `${src.credentialName ?? "MCP 凭证"} · ${src.toolCount} 个只读工具 · ${src.scopeSummary}` : "请先在「MCP 接入」创建只读凭证"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {dsError && <p className={styles.errText}>{dsError}</p>}
                  <div className={styles.dsActions}>
                    <Button size="sm" onClick={() => void saveDataSources()} disabled={dsSaving || dsLoading}>
                      {dsSaving ? <Loader2 size={14} className={styles.spin} /> : <ShieldCheck size={14} />}
                      保存并启用
                    </Button>
                    <a className={styles.dsLink} href="/settings?tab=mcp" target="_blank" rel="noreferrer"><Settings2 size={13} /> 管理 MCP 凭证</a>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {selectedSkill && (
          <div className={styles.skillBar}>
            <Badge tone="info">技能：{selectedSkill.name}</Badge>
            <span className={styles.skillSummary}>{selectedSkill.summary}</span>
            <button className={styles.linkBtn} onClick={() => setSkillSlug("")}>移除</button>
          </div>
        )}

        <div className={styles.messages} aria-live="polite">
          {messages.length === 0 && (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}><Bot size={30} /></div>
              <h2>用自然语言分析你的经营数据</h2>
              <p>模型只能读取你在「数据源 / MCP 配置」中确认启用的只读数据；每条回答都附带来源与覆盖范围。</p>
              <div className={styles.examples}>
                {["对比最近一个完整周的销售额与订单量，并说明数据范围", "查看赛狐店铺近 7 天销售趋势，列出来源与缺口", "当前的销售数据覆盖了哪些店铺和日期？"].map(ex => (
                  <button key={ex} onClick={() => { setDraft(ex); textareaRef.current?.focus(); }}>{ex}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={`${styles.msg} ${m.role === "user" ? styles.msgUser : styles.msgAssistant}`}>
              <div className={styles.msgRole}>{m.role === "user" ? "我" : "AI"}</div>
              <div className={styles.msgBody}>
                <div className={styles.msgText}>{m.content}</div>
                {m.answer && (
                  <div className={styles.msgMeta}>
                    <Badge tone="neutral">{m.answer.tools.length} 次查询</Badge>
                    {m.answer.skill && <Badge tone="neutral">技能 {m.answer.skill.slug}</Badge>}
                    {m.answer.coverage?.slice(0, 2).map((c, i) => <span key={i} className={styles.coverageTag}>{c}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className={`${styles.msg} ${styles.msgAssistant}`}>
              <div className={styles.msgRole}>AI</div>
              <div className={styles.msgBody}>
                <div className={styles.loading}><Loader2 size={16} className={styles.spin} /> {statusText || "正在查询数据并分析…"}</div>
              </div>
            </div>
          )}
          {error && <div className={styles.error}>{error}</div>}
          <div ref={bottomRef} />
        </div>

        <div className={styles.composer}>
          <div className={styles.composerTop}>
            <div className={styles.skillPicker}>
              <select value={skillSlug} onChange={e => applySkill(e.target.value)} aria-label="选择技能">
                <option value="">通用查询（不指定技能）</option>
                {skills.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
              <ChevronDown size={14} className={styles.selectChevron} />
            </div>
            <span className={styles.hint}>Enter 发送 · Shift+Enter 换行</span>
          </div>
          <div className={styles.inputRow}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }}
              placeholder={dataSources?.ready ? "例如：对比最近一个完整周的销售额，并说明数据来自哪里" : "请先在上方「数据源 / MCP 配置」确认启用至少一个数据源"}
              rows={2}
              aria-label="问题输入"
              disabled={!dataSources?.ready}
            />
            {loading ? (
              <Button size="icon" variant="secondary" onClick={() => void cancel()} aria-label="停止生成" title="停止生成"><Square size={16} /></Button>
            ) : (
              <Button size="icon" onClick={() => void send()} disabled={!draft.trim() || !canCreate || !dataSources?.ready} aria-label="发送" title="发送"><Send size={16} /></Button>
            )}
          </div>
        </div>
      </main>

      {rightOpen && (
        <aside className={styles.right}>
          <div className={styles.rightHead}><span>本次分析</span><button className={styles.iconBtn} onClick={() => setRightOpen(false)} aria-label="收起"><ChevronRight size={16} /></button></div>
          {!lastAnswer && <div className={styles.emptyHint}>发送问题后，这里显示技能、数据范围、来源与工具状态。</div>}
          {lastAnswer && (
            <div className={styles.rightBody}>
              <section>
                <h4>技能</h4>
                {lastAnswer.skill ? <div className={styles.kv}><span>{lastAnswer.skill.name}</span><code>{lastAnswer.skill.hash?.slice(0, 12)}</code></div> : <p className={styles.muted}>未指定技能（通用查询）</p>}
              </section>
              <section>
                <h4>数据源</h4>
                {lastAnswer.providers.length === 0 && <p className={styles.muted}>未知</p>}
                {lastAnswer.providers.map(p => (
                  <div key={p.provider} className={styles.kv}>
                    <span>{p.provider}</span>
                    <Badge tone={p.status === "connected" ? "success" : "neutral"}>{p.status === "connected" ? `${p.toolCount} 工具` : p.status}</Badge>
                  </div>
                ))}
              </section>
              <section>
                <h4>查询与来源</h4>
                {lastAnswer.tools.length === 0 && <p className={styles.muted}>本轮未查询数据</p>}
                {lastAnswer.tools.map(t => (
                  <div key={t.seq} className={styles.toolCard}>
                    <div className={styles.toolHead}>
                      <Badge tone={t.status === "ok" ? "success" : "danger"}>{t.provider}</Badge>
                      <span className={styles.toolName}>{t.tool}</span>
                      <span className={styles.muted}>{t.durationMs}ms</span>
                    </div>
                    <div className={styles.toolArgs}>{t.argsSummary}</div>
                    <div className={styles.toolFoot}>
                      {t.rowCount !== undefined && <span>返回 {t.rowCount} 行</span>}
                      {t.resultSource && <span>来源 {t.resultSource}</span>}
                      {t.errorCode && <span className={styles.errText}>{t.errorCode}</span>}
                    </div>
                  </div>
                ))}
              </section>
              <section>
                <h4>覆盖与限制</h4>
                {lastAnswer.coverage.map((c, i) => <p key={i} className={styles.note}>· {c}</p>)}
                {lastAnswer.skipped.map((s, i) => <p key={i} className={styles.note}>· {s}</p>)}
                <p className={styles.muted}>模型：{lastAnswer.model}</p>
              </section>
              <section className={styles.skillFilterBox}>
                <h4>快速筛选技能</h4>
                <input value={skillFilter} onChange={e => setSkillFilter(e.target.value)} placeholder="输入技能名" aria-label="筛选技能" />
                <div className={styles.quickSkills}>
                  {filteredSkills.map(s => <button key={s.slug} onClick={() => applySkill(s.slug)} className={s.slug === skillSlug ? styles.quickActive : ""}>{s.name}</button>)}
                </div>
              </section>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

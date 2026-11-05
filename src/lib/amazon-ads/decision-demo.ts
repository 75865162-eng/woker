/** Isolated UI fixture model. Never use this module as a server permission or execution gateway. */
export type DemoStatus = "draft" | "pending" | "approved" | "rejected" | "executing" | "done" | "partial_failed" | "failed" | "rolled_back";
export type DemoCapability = { state: "supported" | "blocked" | "unsupported"; reason: string };
export type DemoActionType = "update_bid" | "update_budget" | "create_keyword" | "set_budget_rule" | "pause";
export interface DemoEvidence { at: string; metrics: Record<string, number | null> }
export interface DemoEntity {
  id: string; campaign: string; group: string; name: string; kind: "keyword" | "target" | "campaign";
  match: string; status: "enabled" | "paused" | "archived"; bid: number; budget: number; rule: number;
  asins: string[]; spend: number; sales: number;
}
export interface DemoAsin { asin: string; stock: number | null; inbound: number | null; buyBox: boolean | null; totalSales: number | null; adSales: number; spend: number }
export interface DemoAction { type: DemoActionType; entityId: string; value: number; reason: string; keyword?: string; match?: string }
export interface DemoItem { action: DemoAction; before: DemoEntity | null; after: DemoEntity; result: "waiting" | "success" | "failed"; error?: string }
export interface DemoOrder {
  id: string; status: DemoStatus; source: "页面" | "AI" | "官方" | "规则"; tool: string;
  evidence?: DemoEvidence; items: DemoItem[]; reviewed: boolean; inverseOf?: string;
  beforeSnapshot?: string; afterSnapshot?: string;
}
export interface DemoEvent { orderId: string; at: string; actor: string; tool: string; message: string }
export interface DecisionDemo {
  scope: string; market: string; entities: DemoEntity[]; asins: DemoAsin[]; orders: DemoOrder[]; events: DemoEvent[];
  capabilities: { write: DemoCapability; business: DemoCapability; stream: DemoCapability; official: DemoCapability };
}
export const DEMO_EVIDENCE: DemoEvidence = { at: "2026-11-05T08:00:00.000Z", metrics: { spend7d: 80, sales7d: 240, clicks7d: 120 } };
export const demoStatusLabels: Record<DemoStatus, string> = { draft: "草稿", pending: "待模拟审批", approved: "模拟批准", rejected: "模拟拒绝", executing: "模拟执行中", done: "模拟成功", partial_failed: "模拟部分失败", failed: "模拟失败", rolled_back: "已模拟回滚" };
export function createDecisionDemo(account: string, market: string): DecisionDemo {
  const scope = `${account}/${market}`;
  const entity = (id: string, name: string, asin: string, status: DemoEntity["status"] = "enabled"): DemoEntity => ({ id: `${scope}/${id}`, campaign: `DEMO ${market} SP ${id}`, group: "Core keywords", name, kind: "keyword", match: "EXACT", status, bid: 1, budget: 30, rule: 10, asins: [asin], spend: 80, sales: 240 });
  return {
    scope, market, entities: [
      entity("healthy", "storage basket", "B0DEMO0001"), entity("empty", "drawer organizer", "B0DEMO0002"),
      entity("lost", "linen basket", "B0DEMO0003"), entity("unknown", "woven basket", "B0DEMO0004"),
      entity("archived", "old basket", "B0DEMO0001", "archived"), { ...entity("target", 'asin="B0DEMO0001"', "B0DEMO0001"), kind: "target", match: "ASIN" },
      { ...entity("campaign-1", "Campaign 01", "B0DEMO0001"), kind: "campaign", group: "—", name: "Campaign 01", budget: 30, rule: 10 },
      { ...entity("campaign-2", "Campaign 02", "B0DEMO0002"), kind: "campaign", group: "—", name: "Campaign 02", budget: 45, rule: 15 },
    ],
    asins: [
      { asin: "B0DEMO0001", stock: 100, inbound: 20, buyBox: true, totalSales: 800, adSales: 240, spend: 80 },
      { asin: "B0DEMO0002", stock: 0, inbound: 40, buyBox: true, totalSales: null, adSales: 0, spend: 60 },
      { asin: "B0DEMO0003", stock: 5, inbound: 0, buyBox: false, totalSales: 200, adSales: 100, spend: 50 },
      { asin: "B0DEMO0004", stock: null, inbound: null, buyBox: null, totalSales: null, adSales: 0, spend: 0 },
    ], orders: [], events: [], capabilities: {
      write: { state: market === "US" ? "supported" : "blocked", reason: market === "US" ? "仅 US SP 演示策略，非官方限额" : "缺少此站点已核验策略，演示写操作关闭" },
      business: { state: account === "northstar" ? "supported" : "unsupported", reason: "此演示账户没有 SP-API 经营能力" },
      stream: { state: "blocked", reason: "未开通 Marketing Stream" }, official: { state: "blocked", reason: "官方推荐 API 尚未接入" },
    },
  };
}
export function increaseBlockedReason(state: DecisionDemo, entity: DemoEntity): string {
  if (state.capabilities.write.state !== "supported") return state.capabilities.write.reason;
  if (entity.status === "archived") return "实体已归档";
  if (state.capabilities.business.state !== "supported") return "无经营数据能力，不能确认加价安全";
  if (!entity.asins.length) return "缺少关联 ASIN";
  for (const asin of entity.asins) {
    const context = state.asins.find(row => row.asin === asin);
    if (!context || context.stock === null || context.buyBox === null) return "经营数据未知，需先核实";
    if (context.stock <= 0) return "断货，禁止提价或加预算";
    if (!context.buyBox) return "BuyBox 丢失，禁止提价或加预算";
  }
  return "";
}
export function asinDemoStatus(row: DemoAsin): string {
  if (row.stock === null || row.buyBox === null) return "数据未知";
  if (row.stock <= 0) return "断货";
  if (!row.buyBox) return "BuyBox 丢失";
  return row.stock < 10 ? "低库存" : "正常";
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function field(type: DemoActionType): "bid" | "budget" | "rule" | "status" { return type === "update_budget" ? "budget" : type === "set_budget_rule" ? "rule" : type === "pause" ? "status" : "bid"; }
function identity(entity: DemoEntity): string { return [entity.campaign, entity.group, entity.name.trim().toLowerCase().replace(/\s+/g, " "), entity.match].join("|"); }
function evidenceValid(evidence?: DemoEvidence): boolean { return !!evidence && Number.isFinite(Date.parse(evidence.at)) && Object.values(evidence.metrics).some(v => typeof v === "number" && Number.isFinite(v)); }
function event(state: DecisionDemo, order: DemoOrder, message: string): DecisionDemo {
  return { ...state, events: [...state.events, { orderId: order.id, at: new Date().toISOString(), actor: order.source === "AI" ? "演示 AI 提案（非真实 MCP）" : "演示操作者", tool: order.tool, message }] };
}
function validate(state: DecisionDemo, action: DemoAction): DemoEntity {
  if (state.capabilities.write.state !== "supported") throw new Error(state.capabilities.write.reason);
  const entity = state.entities.find(row => row.id === action.entityId);
  if (!entity) throw new Error("实体不存在或不属于当前演示范围");
  if (entity.status === "archived") throw new Error("实体已归档");
  if (!action.reason.trim()) throw new Error("必须填写依据摘要");
  if (!Number.isFinite(action.value)) throw new Error("值必须为有限数字");
  if (action.type === "pause" && action.value !== 0 && action.value !== 1) throw new Error("无效状态值");
  if ((action.type === "update_bid" || action.type === "create_keyword") && (action.value < 0.02 || action.value > 100)) throw new Error("US SP 演示保守闸门：0.02–100 USD；非官方限额");
  if (action.type === "update_budget" && (action.value < 1 || action.value > 100000)) throw new Error("预算超出演示范围：1–100000 USD");
  if (action.type === "set_budget_rule" && (action.value < 0 || action.value > 30)) throw new Error("规则提高比例超出演示范围：0–30%");
  const increase = action.type === "create_keyword" || action.type === "update_bid" && action.value > entity.bid || action.type === "update_budget" && action.value > entity.budget || action.type === "set_budget_rule" && action.value > entity.rule || action.type === "pause" && action.value === 1;
  if (increase) { const reason = increaseBlockedReason(state, entity); if (reason) throw new Error(reason); }
  return entity;
}
export function prepareDemoOrder(state: DecisionDemo, input: { id: string; actions: DemoAction[]; source: DemoOrder["source"]; evidence?: DemoEvidence; inverseOf?: string }): DecisionDemo {
  if (!input.actions.length || input.actions.length > 100) throw new Error("每单需要 1–100 条动作");
  if (new Set(input.actions.map(action => action.entityId)).size !== input.actions.length) throw new Error("同一变更单不允许重复实体，请合并动作后重新生成");
  if (state.orders.some(order => order.id === input.id)) throw new Error("变更单 ID 重复");
  if (input.source === "AI" && !evidenceValid(input.evidence)) throw new Error("AI 建议缺少数据时间戳与有效指标");
  const working = clone(state);
  const items = input.actions.map(action => {
    const entity = validate(working, action);
    let after = clone(entity);
    if (action.type === "create_keyword") {
      if (!action.keyword?.trim() || !["EXACT", "PHRASE", "BROAD"].includes(action.match ?? "")) throw new Error("填写关键词和有效匹配类型");
      after = { ...after, id: `${state.scope}/new/${input.id}/${action.entityId}`, kind: "keyword", name: action.keyword.trim(), match: action.match!, bid: action.value, status: "paused", spend: 0, sales: 0 };
      const reserved = state.orders.filter(order => !["rejected", "failed", "rolled_back"].includes(order.status)).flatMap(order => order.items.filter(item => item.action.type === "create_keyword").map(item => item.after));
      if ([...working.entities, ...reserved].some(row => row.kind === "keyword" && identity(row) === identity(after))) throw new Error("相同 Campaign/Ad Group/关键词/匹配类型已存在或正在审批");
      working.entities.push(after);
    } else {
      if (action.type === "pause") after.status = action.value === 0 ? "paused" : "enabled";
      else after = { ...after, [field(action.type)]: action.value };
      if (JSON.stringify(after) === JSON.stringify(entity)) throw new Error("目标值未变化");
      working.entities = working.entities.map(row => row.id === after.id ? after : row);
    }
    return { action: clone(action), before: action.type === "create_keyword" ? null : clone(entity), after, result: "waiting" as const };
  });
  const order: DemoOrder = { id: input.id, source: input.source, tool: input.source === "AI" ? "demo.ai.propose" : "demo.ui.propose", evidence: clone(input.evidence ?? DEMO_EVIDENCE), status: "draft", items, reviewed: false, inverseOf: input.inverseOf };
  return event({ ...state, orders: [...state.orders, order] }, order, "生成演示草稿；尚未提交审批");
}
function replace(state: DecisionDemo, order: DemoOrder, message: string): DecisionDemo { return event({ ...state, orders: state.orders.map(row => row.id === order.id ? order : row) }, order, message); }
export function transitionDemoOrder(state: DecisionDemo, id: string, command: "review" | "submit" | "approve" | "reject" | "execute" | "finish", failIds: string[] = []): DecisionDemo {
  const existing = state.orders.find(order => order.id === id);
  if (!existing) throw new Error("变更单不存在");
  const order = clone(existing);
  const allowed = { review: "draft", submit: "draft", approve: "pending", reject: "pending", execute: "approved", finish: "executing" };
  if (order.status !== allowed[command]) throw new Error("状态已变化，不能重复操作");
  if (["submit", "execute", "finish"].includes(command)) {
    if (!order.reviewed) throw new Error("必须先查看 dry-run 影响");
    if (order.source === "AI" && !evidenceValid(order.evidence)) throw new Error("AI 建议缺少依据");
    for (const item of order.items) {
      validate(state, item.action);
      if (item.before && JSON.stringify(state.entities.find(row => row.id === item.before!.id)) !== JSON.stringify(item.before)) throw new Error("当前值与 dry-run 快照冲突，请重新生成草稿");
      if (!item.before && state.entities.some(row => identity(row) === identity(item.after))) throw new Error("关键词已存在，请重新生成草稿");
    }
  }
  if (command === "review") order.reviewed = true;
  if (command === "submit") order.status = "pending";
  if (command === "approve") order.status = "approved";
  if (command === "reject") order.status = "rejected";
  if (command === "execute") { order.status = "executing"; order.beforeSnapshot = `${id}/before`; }
  if (command !== "finish") return replace(state, order, command === "review" ? "已展示并确认 dry-run 影响" : `模拟操作 ${command}：${demoStatusLabels[order.status]}`);
  order.items.forEach(item => { item.result = failIds.includes(item.action.entityId) ? "failed" : "success"; if (item.result === "failed") item.error = "DEMO_REJECTED：模拟上游拒绝，未应用"; });
  const succeeded = order.items.filter(item => item.result === "success");
  order.status = succeeded.length === order.items.length ? "done" : succeeded.length ? "partial_failed" : "failed";
  order.afterSnapshot = `${id}/after`;
  let next = { ...state, entities: clone(state.entities) };
  succeeded.forEach(item => { next.entities = item.before ? next.entities.map(row => row.id === item.after.id ? clone(item.after) : row) : [...next.entities, clone(item.after)]; });
  next = replace(next, order, `模拟执行完成：${demoStatusLabels[order.status]}；${succeeded.length}/${order.items.length} 条成功`);
  if (order.inverseOf && order.status === "done") {
    const original = next.orders.find(row => row.id === order.inverseOf)!;
    next = replace(next, { ...original, status: "rolled_back" }, `逆向单 ${order.id} 模拟成功，原单已回滚`);
  }
  return next;
}
export function prepareDemoRollback(state: DecisionDemo, id: string, inverseId: string): DecisionDemo {
  const order = state.orders.find(row => row.id === id);
  if (!order || !["done", "partial_failed"].includes(order.status) || order.inverseOf) throw new Error("此状态不能回滚");
  if (state.orders.some(row => row.inverseOf === id && row.status !== "rejected")) throw new Error("已生成逆向单，请查看原逆向单；不重复生成");
  const actions = order.items.filter(item => item.result === "success").map(item => {
    if (!item.before) throw new Error("创建动作不支持自动逆向，需人工制定补偿方案");
    const current = state.entities.find(row => row.id === item.after.id);
    if (!current || current.status === "archived") throw new Error("归档或缺失实体不可回滚");
    if (JSON.stringify(current) !== JSON.stringify(item.after)) throw new Error("当前值与执行后快照冲突，不可覆盖后续修改");
    const oldValue = item.action.type === "pause" ? item.before.status === "paused" ? 0 : 1 : item.before[field(item.action.type)];
    return { ...item.action, value: Number(oldValue), reason: `逆向 ${id}：${item.action.reason}` };
  });
  return prepareDemoOrder(state, { id: inverseId, source: "页面", actions, inverseOf: id });
}

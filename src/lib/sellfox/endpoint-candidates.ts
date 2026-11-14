import { sellfoxPlanGroups, type SellfoxPlanItem } from "./data-plan";

/**
 * 待接入数据集 → 泛化端点候选。
 *
 * 背景：data-plan.ts 里 28+ 个 `planned` 数据集不需要各写一个同步器。
 * 通用采集器（generic-endpoint-sync.ts）已能按「店铺 × 日期块」拉取任意只读接口，
 * 并把原始响应整行落到 SellfoxApiRecord，再由 /sellfox/endpoint-data 承接验收。
 *
 * 真实性边界（必须保持）：
 * - 只收录 data-plan.ts 中已核对过的真实 /api/ 路径；标注「文档：…」的路径一律不收。
 * - 过滤写接口（create/update/delete/add 等），系统只做读，不接增删改。
 * - 参数模板（params）明确标记为「待联调」，不猜请求字段名，不自动生成可执行端点。
 * - 这里只产出候选清单，不写数据库、不自动启用；启用前必须由运维补齐参数契约。
 */
export type SellfoxEndpointCandidate = {
  code: string;
  label: string;
  priority: "P0" | "P1" | "P2";
  paths: string[];
  paramsContract: "PENDING_API_CONTRACT";
  note: string;
};

const WRITE_PATH = /\/(create|insert|update|delete|remove|add|modify|save|submit|cancel|close|approve|reject|audit|enable|disable|batch)[A-Za-z0-9_]*\.json$/i;
const SAFE_PATH = /^\/api\/[A-Za-z0-9_./-]{2,180}\.json$/;
const CODE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export function sellfoxEndpointCandidates(): SellfoxEndpointCandidate[] {
  const items: SellfoxPlanItem[] = sellfoxPlanGroups.flatMap(group => group.items);
  const candidates: SellfoxEndpointCandidate[] = [];
  for (const item of items) {
    if (item.status !== "planned") continue; // live 已有内置同步器；blocked 缺平台授权，不做
    if (!CODE.test(item.id)) continue;
    const paths = item.api.filter(path => SAFE_PATH.test(path) && !WRITE_PATH.test(path));
    if (!paths.length) continue;
    candidates.push({
      code: item.id,
      label: item.label,
      priority: item.priority,
      paths,
      paramsContract: "PENDING_API_CONTRACT",
      note: item.note ?? "请求参数名/分页字段需按赛狐接口文档或联调结果补齐后才能启用；不猜字段。",
    });
  }
  return candidates.sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code));
}

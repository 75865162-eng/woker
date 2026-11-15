import { sellfoxKnownEndpoints } from "./known-endpoints";

export const sellfoxEndpointPolicyVersion = 1;

/** 封闭白名单只接受已登记查询端点及其参数契约，不接受路径归一化或任意 POST。 */
export function assertSellfoxReadonlyEndpoint(endpoint: {
  path: string; params: string; scopeMode: string; dateMode: string; dateFormat: string;
  pageSize: number; chunkDays: number;
}) {
  const policy = sellfoxKnownEndpoints().find(item => item.path === endpoint.path);
  if (!policy || policy.deprecated) throw new Error("端点不在已审核只读白名单中或已退役，禁止采集。");
  if (endpoint.scopeMode !== policy.scopeMode || endpoint.dateMode !== policy.dateMode
    || endpoint.dateFormat !== policy.dateFormat || endpoint.pageSize > policy.pageSize
    || endpoint.pageSize < 1 || endpoint.chunkDays < 1 || endpoint.chunkDays > policy.chunkDays) {
    throw new Error("端点范围、日期或分页配置不符合只读白名单契约。");
  }
  const normalize = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(normalize).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${normalize(item)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  if (normalize(JSON.parse(endpoint.params)) !== normalize(JSON.parse(policy.params))) {
    throw new Error("端点参数模板不符合已审核只读契约。");
  }
}

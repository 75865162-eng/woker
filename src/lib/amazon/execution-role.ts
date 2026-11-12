import { SyncInputError } from "@/lib/amazon-sync/policy";

/** Server process configuration only. Request arguments and client roles cannot
 * grant official API execution. Missing/unknown values fail closed as local.
 */
export function amazonCloudExecutionEnabled() {
  return process.env.AMAZON_API_EXECUTION_ROLE === "cloud";
}

export class AmazonCloudExecutionError extends SyncInputError {
  readonly code = "CLOUD_EXECUTION_REQUIRED";
  readonly retryable = false;
  constructor() {
    super("Amazon 官方 API 仅允许云端执行；当前进程未配置云端执行角色。请通过云端完成授权、同步或执行。", 409);
  }
}

export function assertAmazonCloudExecution() {
  if (!amazonCloudExecutionEnabled()) throw new AmazonCloudExecutionError();
}

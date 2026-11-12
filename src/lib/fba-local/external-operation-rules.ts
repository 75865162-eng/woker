import { WmsError } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';
import { object } from './rules';
import { externalWorkflowSteps, type ExternalWorkflowStep } from './external-operation-contract';
export function parseExternalOperationRecord(raw: unknown) {
  const input = object(raw);
  strictKeys(input, ['idempotencyKey', 'step', 'operationName', 'requestDigest', 'requestId', 'operationId', 'entityId', 'evidence']);
  if (!externalWorkflowSteps.includes(input.step as ExternalWorkflowStep)) throw new WmsError('外部工作流步骤无效。', 400);
  const requestDigest = requireText(input.requestDigest, '原请求 SHA-256 摘要');
  if (!/^[a-f0-9]{64}$/.test(requestDigest)) throw new WmsError('请求摘要须为小写 SHA-256。', 400);
  const operationName = requireText(input.operationName, '外部操作名', 100);
  if (!/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(operationName)) throw new WmsError('操作名格式无效。', 400);
  const optional = (key: string) => input[key] == null || input[key] === '' ? null : requireText(input[key], key, 200);
  return { idempotencyKey: requireText(input.idempotencyKey, '幂等键'), step: input.step as ExternalWorkflowStep, operationName, requestDigest, requestId: optional('requestId'), operationId: optional('operationId'), entityId: optional('entityId'), evidence: requireText(input.evidence, '原操作核实依据', 2000) };
}
export function parseExternalResolution(raw: unknown) {
  const input = object(raw);
  strictKeys(input, ['recordId', 'result', 'operationId', 'entityId', 'evidence']);
  if (input.result !== 'SUCCEEDED' && input.result !== 'FAILED') throw new WmsError('须明确核实成功或失败。', 400);
  const optional = (key: string) => input[key] == null || input[key] === '' ? null : requireText(input[key], key, 200);
  const entityId = optional('entityId'), operationId = optional('operationId');
  if (input.result === 'SUCCEEDED' && !entityId && !operationId) throw new WmsError('成功核实须提供外部实体或 operation ID。', 400);
  return { recordId: requireText(input.recordId, '操作记录 ID'), result: input.result, operationId, entityId, evidence: requireText(input.evidence, '结果核实依据', 2000) };
}

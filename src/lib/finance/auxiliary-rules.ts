import { WmsError } from '@/lib/wms/contracts';
import { requireText, strictKeys } from '@/lib/wms/rules';
export type AuxiliaryAssignment = { lineNumber: number; typeId: string; itemId: string };
export function parseAuxiliaryAssignments(value: unknown): AuxiliaryAssignment[] {
  if (!Array.isArray(value) || value.length > 1000) throw new WmsError('辅助核算须为不超过 1000 项的数组。', 400);
  const keys = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsError('辅助核算项目无效。', 400);
    const row = raw as Record<string, unknown>; strictKeys(row, ['lineNumber', 'typeId', 'itemId']);
    const lineNumber = row.lineNumber;
    if (typeof lineNumber !== 'number' || !Number.isSafeInteger(lineNumber) || lineNumber < 1 || lineNumber > 200) throw new WmsError('辅助核算分录序号须为 1–200。', 400);
    const typeId = requireText(row.typeId, '辅助类型 ID'), itemId = requireText(row.itemId, '辅助项目 ID');
    const key = JSON.stringify([lineNumber, typeId]);
    if (keys.has(key)) throw new WmsError('同一分录不能重复分配辅助类型。', 400);
    keys.add(key); return { lineNumber, typeId, itemId };
  }).sort((a, b) => a.lineNumber - b.lineNumber || a.typeId.localeCompare(b.typeId));
}
export function validateAuxiliaryAssignments(lines: Array<{ lineNumber: number; subjectId: string }>, rules: Array<{ subjectId: string; typeId: string; required: boolean }>, assignments: AuxiliaryAssignment[]) {
  for (const row of assignments) {
    const line = lines.find(line => line.lineNumber === row.lineNumber);
    if (!line || !rules.some(rule => rule.subjectId === line.subjectId && rule.typeId === row.typeId)) throw new WmsError('辅助核算类型未绑定到该分录科目。', 422);
  }
  for (const line of lines) for (const rule of rules.filter(rule => rule.subjectId === line.subjectId && rule.required)) {
    if (!assignments.some(row => row.lineNumber === line.lineNumber && row.typeId === rule.typeId)) throw new WmsError(`第 ${line.lineNumber} 行缺少必填辅助核算。`, 422);
  }
}

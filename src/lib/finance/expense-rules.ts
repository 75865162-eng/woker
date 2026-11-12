export type ExpenseState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export function validateExpenseDraft(input: {
  number: string; category: string; payee: string; description: string;
  expenseDate: string; amount: string; currency: string;
  debitSubjectId: string; creditSubjectId: string;
}) {
  for (const [value, label, max] of [
    [input.number, '费用单号', 80], [input.category, '费用类别', 80],
    [input.payee, '收款对象', 160], [input.description, '费用说明', 500],
    [input.debitSubjectId, '借方科目', 100], [input.creditSubjectId, '贷方科目', 100],
  ] as const) {
    if (!value || value.trim() !== value || value.length > max) throw new Error(`${label}无效。`);
  }
  if (input.debitSubjectId === input.creditSubjectId) throw new Error('费用借方和贷方科目不能相同。');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('币种须为三位大写代码。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate) || !Number.isFinite(Date.parse(`${input.expenseDate}T00:00:00Z`)) || new Date(`${input.expenseDate}T00:00:00Z`).toISOString().slice(0, 10) !== input.expenseDate) throw new Error('费用日期无效。');
  if (typeof input.amount !== 'string' || !/^(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/.test(input.amount) || !/[1-9]/.test(input.amount)) throw new Error('金额须为大于零且最多六位小数的十进制字符串。');
  return input;
}

export function nextExpenseState(state: ExpenseState, action: 'SUBMIT' | 'APPROVE' | 'REJECT'): ExpenseState {
  if (state === 'DRAFT' && action === 'SUBMIT') return 'SUBMITTED';
  if (state === 'SUBMITTED' && action === 'APPROVE') return 'APPROVED';
  if (state === 'SUBMITTED' && action === 'REJECT') return 'REJECTED';
  throw new Error('费用单状态已变化，当前操作不可用。');
}

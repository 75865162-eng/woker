/**
 * 赛狐只读工作台的金额展示序列化边界。
 *
 * 数据层存储与运算一律使用 Prisma.Decimal（decimal.js），禁止 JS Number 参与金额运算；
 * 但工作台/导出/JSON API 的展示契约 historically 使用 number，因此在读取出口统一转成 number。
 * 这里只做展示序列化，不参与任何金额计算；null 保持 null（缺失数据不补造零值）。
 */
export function moneyToNumber(value: { toString(): string } | null | undefined): number | null {
  return value == null ? null : Number(value.toString());
}

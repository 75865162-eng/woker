/** Exact display of six-decimal ledger amounts, including red reversals. */
export function sumLedgerAmounts(values: readonly string[]) {
  let total = BigInt(0);
  for (const value of values) {
    if (!/^-?\d{1,24}(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid ledger amount');
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const micros = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
    total += negative ? -micros : micros;
  }
  const absolute = total < BigInt(0) ? -total : total;
  return `${total < BigInt(0) ? '-' : ''}${absolute / BigInt(1000000)}.${String(absolute % BigInt(1000000)).padStart(6, '0')}`;
}

type AmountLine = { expectedQty: number | string; unitPrice: string };
const scale = BigInt(1_000_000);

/** Purchase amounts are decimal text throughout; no floating-point currency arithmetic. */
function lineAmountUnits(line: AmountLine): bigint | null {
  const quantity = String(line.expectedQty);
  if (!/^[1-9][0-9]{0,9}$/.test(quantity) || BigInt(quantity) > BigInt(2147483647) || !/^[0-9]{1,14}([.][0-9]{1,6})?$/.test(line.unitPrice)) return null;
  const [whole, fraction = ""] = line.unitPrice.split(".");
  return (BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"))) * BigInt(quantity);
}
function amountText(units: bigint) {
  const fraction = (units % scale).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return (units / scale).toString() + "." + fraction;
}
export function purchaseLineAmount(line: AmountLine): string | null {
  const units = lineAmountUnits(line);
  return units === null ? null : amountText(units);
}
export function purchaseOrderAmount(lines: AmountLine[]): string | null {
  if (!lines.length) return null;
  let total = BigInt(0);
  for (const line of lines) {
    const units = lineAmountUnits(line);
    if (units === null) return null;
    total += units;
  }
  return amountText(total);
}

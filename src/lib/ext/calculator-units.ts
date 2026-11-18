export type WeightUnit = 'lb' | 'kg' | 'oz';
export type DimensionUnit = 'in' | 'cm';
export const weightUnits: WeightUnit[] = ['lb', 'kg', 'oz'];
export const dimensionUnits: DimensionUnit[] = ['in', 'cm'];
const factors = { lb: 1, kg: 0.45359237, oz: 16, in: 1, cm: 2.54 };

/** Canonical values remain lb/in; changing display units never changes the quote inputs. */
export function displayMeasurement(value: string, unit: WeightUnit | DimensionUnit): string {
  if (!value.trim() || !Number.isFinite(Number(value))) return value;
  return String(Number((Number(value) * factors[unit]).toPrecision(12)));
}
export function canonicalMeasurement(value: string, unit: WeightUnit | DimensionUnit): string {
  if (!value.trim() || !Number.isFinite(Number(value))) return value;
  return String(Number((Number(value) / factors[unit]).toPrecision(14)));
}

/** The size-limit column contains only inches, including any girth limit. */
export function sizeLimitInCentimeters(value: string): string {
  return value.replace(/\d+(?:\.\d+)?/g, number => String(Number((Number(number) * 2.54).toFixed(3))))
    .replace(/英寸/g, '厘米');
}

export type FreightChargeMode = "WEIGHT" | "DIMENSIONAL_WEIGHT" | "VOLUME";

export type FreightEstimateInput = {
  mode: FreightChargeMode;
  quantity: string;
  grossWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  divisorCm3PerKg: string;
  ratePerKg: string;
  currency: string;
};

export type FreightEstimate = {
  actualWeightKg: string | null;
  chargeableWeightKg: string;
  estimatedFreight: string;
  currency: string;
};

export type FbaStorageEstimateInput = {
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  monthlyRatePerCubicFoot: string;
  months: string;
  currency: string;
};

export type FbaStorageEstimate = {
  volumeCubicFeet: string;
  estimatedFee: string;
  currency: string;
};

type Decimal = { coefficient: bigint; scale: number };

const pow10 = (scale: number) => BigInt(10) ** BigInt(scale);

function decimal(value: string, label: string, allowZero = true): Decimal {
  const normalized = value.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(normalized);
  if (!match) throw new Error(`${label}请输入非负数字，最多 8 位小数。`);
  const fraction = match[2] ?? "";
  const coefficient = BigInt(`${match[1]}${fraction}`);
  if (!allowZero && coefficient === BigInt(0)) throw new Error(`${label}必须大于 0。`);
  return { coefficient, scale: fraction.length };
}

function roundDivision(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
}

function scaled(value: Decimal, targetScale: number) {
  return value.scale <= targetScale
    ? value.coefficient * pow10(targetScale - value.scale)
    : roundDivision(value.coefficient, pow10(value.scale - targetScale));
}

function ratioAtScale(numerator: Decimal, denominator: Decimal, targetScale: number) {
  return roundDivision(
    numerator.coefficient * pow10(denominator.scale + targetScale),
    denominator.coefficient * pow10(numerator.scale),
  );
}

function fixed(value: bigint, sourceScale: number, outputScale: number) {
  const output = scaled({ coefficient: value, scale: sourceScale }, outputScale);
  const sign = output < BigInt(0) ? "-" : "";
  const digits = (output < BigInt(0) ? -output : output).toString().padStart(outputScale + 1, "0");
  if (outputScale === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -outputScale)}.${digits.slice(-outputScale)}`;
}

export function estimateFreight(input: FreightEstimateInput): FreightEstimate {
  const quantityValue = decimal(input.quantity, "件数", false);
  if (quantityValue.scale !== 0 || quantityValue.coefficient > BigInt(1_000_000)) throw new Error("件数必须是 1 到 1,000,000 的整数。");
  const quantity = quantityValue.coefficient;
  const rate = decimal(input.ratePerKg, "每公斤运价");
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("请输入三位币种代码，例如 CNY 或 USD。");

  let actualWeight: bigint | null = null;
  if (input.grossWeightKg.trim()) {
    const weight = decimal(input.grossWeightKg, "单件毛重");
    actualWeight = scaled(weight, 8) * quantity;
  }

  let chargeablePerUnit: bigint;
  if (input.mode === "WEIGHT") {
    if (actualWeight === null) throw new Error("按重量计费需要填写单件毛重。");
    chargeablePerUnit = actualWeight / quantity;
  } else {
    const length = decimal(input.lengthCm, "长", false);
    const width = decimal(input.widthCm, "宽", false);
    const height = decimal(input.heightCm, "高", false);
    const divisor = decimal(input.divisorCm3PerKg, "体积换算系数", false);
    const volume = {
      coefficient: length.coefficient * width.coefficient * height.coefficient,
      scale: length.scale + width.scale + height.scale,
    };
    const dimensionalScale = input.mode === "VOLUME" ? 4 : 8;
    const dimensionalWeight = ratioAtScale(volume, divisor, dimensionalScale);
    const dimensionalWeightAt8 = scaled({ coefficient: dimensionalWeight, scale: dimensionalScale }, 8);
    if (input.mode === "VOLUME") chargeablePerUnit = dimensionalWeightAt8;
    else {
      if (actualWeight === null) throw new Error("体积重取大需要填写单件毛重。");
      const actualPerUnit = actualWeight / quantity;
      chargeablePerUnit = actualPerUnit > dimensionalWeightAt8 ? actualPerUnit : dimensionalWeightAt8;
    }
  }

  // Keep the estimate in scaled integers so unit-rate multiplication rounds to cents once.
  const chargeableTotal = chargeablePerUnit * quantity;
  const estimatedCents = roundDivision(chargeableTotal * rate.coefficient * BigInt(100), pow10(8 + rate.scale));
  return {
    actualWeightKg: actualWeight === null ? null : fixed(actualWeight, 8, 3),
    chargeableWeightKg: fixed(chargeableTotal, 8, 3),
    estimatedFreight: fixed(estimatedCents, 2, 2),
    currency,
  };
}

export function estimateFbaStorage(input: FbaStorageEstimateInput): FbaStorageEstimate {
  const length = decimal(input.lengthIn, "长", false);
  const width = decimal(input.widthIn, "宽", false);
  const height = decimal(input.heightIn, "高", false);
  const monthlyRate = decimal(input.monthlyRatePerCubicFoot, "每立方英尺月费");
  const months = decimal(input.months, "月份", false);
  if (months.scale !== 0 || months.coefficient > BigInt(1200)) throw new Error("月份必须是 1 到 1,200 的整数。");
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("请输入三位币种代码，例如 USD 或 GBP。");

  const volume = {
    coefficient: length.coefficient * width.coefficient * height.coefficient,
    scale: length.scale + width.scale + height.scale,
  };
  const cubicFeet = ratioAtScale(volume, decimal("1728", "立方英寸换算系数", false), 4);
  const feeCoefficient = cubicFeet * monthlyRate.coefficient * months.coefficient;
  const feeScale = 4 + monthlyRate.scale;
  return {
    volumeCubicFeet: fixed(cubicFeet, 4, 4),
    estimatedFee: fixed(feeCoefficient, feeScale, feeScale),
    currency,
  };
}

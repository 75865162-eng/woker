"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { estimateFbaStorage, estimateFreight, type FbaStorageEstimateInput, type FreightChargeMode, type FreightEstimateInput } from "@/lib/logistics/freight-estimate";

const modes: { value: FreightChargeMode; label: string }[] = [
  { value: "WEIGHT", label: "按重量" },
  { value: "DIMENSIONAL_WEIGHT", label: "重量与体积重取大" },
  { value: "VOLUME", label: "按体积重" },
];

const initialInput: FreightEstimateInput = {
  mode: "DIMENSIONAL_WEIGHT", quantity: "1", grossWeightKg: "", lengthCm: "", widthCm: "", heightCm: "",
  divisorCm3PerKg: "6000", ratePerKg: "", currency: "CNY",
};

export function FreightEstimator() {
  const [input, setInput] = useState(initialInput);
  const [touched, setTouched] = useState(false);
  const estimate = useMemo(() => {
    try {
      return { value: estimateFreight(input), error: "" };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "请检查输入。" };
    }
  }, [input]);
  const volumetric = input.mode !== "WEIGHT";

  const update = (field: keyof FreightEstimateInput, value: string) => {
    setTouched(true);
    setInput(current => ({ ...current, [field]: value }));
  };

  return <div className="space-y-4"><Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-brand" aria-hidden="true" />
        <CardTitle>头程运费估算</CardTitle>
      </div>
      <p className="mt-1 text-sm text-muted">根据货物重量、尺寸和人工输入的费率计算参考金额</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div role="group" aria-label="计费方式" className="flex flex-wrap gap-1 border-b border-border">
        {modes.map(mode => <button key={mode.value} type="button" aria-pressed={input.mode === mode.value}
          onClick={() => update("mode", mode.value)}
          className={`min-h-10 border-b-2 px-3 text-sm ${input.mode === mode.value ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-foreground"}`}>
          {mode.label}
        </button>)}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="件数" value={input.quantity} onChange={value => update("quantity", value)} min="1" step="1" />
        <Input label="单件毛重（kg）" value={input.grossWeightKg} onChange={value => update("grossWeightKg", value)} step="any" required={input.mode !== "VOLUME"} />
        {volumetric && <>
          <Input label="长（cm）" value={input.lengthCm} onChange={value => update("lengthCm", value)} step="any" required />
          <Input label="宽（cm）" value={input.widthCm} onChange={value => update("widthCm", value)} step="any" required />
          <Input label="高（cm）" value={input.heightCm} onChange={value => update("heightCm", value)} step="any" required />
          <Input label="体积换算系数（cm³/kg）" value={input.divisorCm3PerKg} onChange={value => update("divisorCm3PerKg", value)} step="any" required />
        </>}
        <Input label="运价（币种/kg）" value={input.ratePerKg} onChange={value => update("ratePerKg", value)} step="any" required />
        <label className="grid gap-1 text-xs text-muted">币种代码<input aria-label="币种代码" value={input.currency} onChange={event => update("currency", event.target.value)} maxLength={3} className="h-9 min-w-0 border border-border px-2 text-sm text-foreground" /></label>
      </div>

      <div aria-live="polite" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
        <Metric label="计费重量" value={estimate.value ? `${estimate.value.chargeableWeightKg} kg` : "--"} />
        <Metric label="货物总毛重" value={estimate.value?.actualWeightKg ? `${estimate.value.actualWeightKg} kg` : "--"} />
        <Metric label="参考运费" value={estimate.value ? `${estimate.value.currency} ${estimate.value.estimatedFreight}` : "--"} />
      </div>
      {touched && estimate.error && <p role="status" className="text-sm text-amber-800">{estimate.error}</p>}
      <p className="text-xs text-muted">结果为本地估算，不含最低收费、附加费、税费或汇率换算；不代表货代报价、Amazon 费用或已发生的物流成本。</p>
    </CardContent>
  </Card><FbaStorageEstimator /></div>;
}

function FbaStorageEstimator() {
  const [input, setInput] = useState<FbaStorageEstimateInput>({ lengthIn: "", widthIn: "", heightIn: "", monthlyRatePerCubicFoot: "", months: "1", currency: "USD" });
  const [touched, setTouched] = useState(false);
  const estimate = useMemo(() => {
    try { return { value: estimateFbaStorage(input), error: "" }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : "请检查输入。" }; }
  }, [input]);
  const update = (field: keyof FbaStorageEstimateInput, value: string) => {
    setTouched(true);
    setInput(current => ({ ...current, [field]: value }));
  };

  return <Card>
    <CardHeader>
      <div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-brand" aria-hidden="true" /><CardTitle>FBA 月仓储费估算</CardTitle></div>
      <p className="mt-1 text-sm text-muted">按商品体积、人工输入的月费和月份数计算参考金额</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input label="长（in）" value={input.lengthIn} onChange={value => update("lengthIn", value)} step="any" required />
        <Input label="宽（in）" value={input.widthIn} onChange={value => update("widthIn", value)} step="any" required />
        <Input label="高（in）" value={input.heightIn} onChange={value => update("heightIn", value)} step="any" required />
        <Input label="每立方英尺月费" value={input.monthlyRatePerCubicFoot} onChange={value => update("monthlyRatePerCubicFoot", value)} step="any" required />
        <Input label="月份" value={input.months} onChange={value => update("months", value)} min="1" step="1" required />
        <label className="grid gap-1 text-xs text-muted">币种代码<input aria-label="仓储费币种代码" value={input.currency} onChange={event => update("currency", event.target.value)} maxLength={3} className="h-9 min-w-0 border border-border px-2 text-sm text-foreground" /></label>
      </div>
      <div aria-live="polite" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <Metric label="计费体积" value={estimate.value ? `${estimate.value.volumeCubicFeet} ft³` : "--"} />
        <Metric label="估算仓储费" value={estimate.value ? `${estimate.value.currency} ${estimate.value.estimatedFee}` : "--"} />
      </div>
      {touched && estimate.error && <p role="status" className="text-sm text-amber-800">{estimate.error}</p>}
      <p className="text-xs text-muted">沿用 Wimoor 的立方英寸换算和月费乘积公式；不含季节、库龄、站点费率规则或 Amazon 实际账单，结果不会写入财务账。</p>
    </CardContent>
  </Card>;
}

function Input({ label, value, onChange, min, step, required }: { label: string; value: string; onChange: (value: string) => void; min?: string; step: string; required?: boolean }) {
  return <label className="grid gap-1 text-xs text-muted">{label}{required ? " *" : ""}<input type="number" min={min ?? "0"} step={step} value={value} onChange={event => onChange(event.target.value)} className="h-9 min-w-0 border border-border px-2 text-sm text-foreground" /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>;
}

"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trendPoints } from "@/data/mock-data";

export function TrendChart() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-[280px] min-h-[280px] w-full min-w-0 rounded-md bg-surface-muted" />;
  }

  return (
    <div className="h-[280px] min-h-[280px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trendPoints} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#176B87" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#176B87" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#D9E0E7" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "#667085", fontSize: 12 }} width={44} />
          <Tooltip
            contentStyle={{
              border: "1px solid #D9E0E7",
              borderRadius: 8,
              boxShadow: "0 10px 28px rgba(17, 24, 39, 0.08)",
            }}
          />
          <Area type="monotone" dataKey="sales" name="Sales" stroke="#176B87" strokeWidth={2} fill="url(#salesFill)" />
          <Area type="monotone" dataKey="spend" name="Spend" stroke="#F59E0B" strokeWidth={2} fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

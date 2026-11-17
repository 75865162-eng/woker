"use client";

import { useState } from "react";
import { type TrialKeywordRow } from "./product-workbench-model";

export function KeywordBulkInput({ onApply }: { onApply: (keywords: TrialKeywordRow[]) => void }) {
  const [value, setValue] = useState("");

  function handleChange(nextValue: string) {
    setValue(nextValue);
    const keywords = parseKeywordBulkText(nextValue);
    if (keywords.length) {
      onApply(keywords);
    }
  }

  return (
    <label className="flex h-full flex-col text-xs font-semibold text-muted">
      批量输入关键词
      <textarea
        className="mt-1 min-h-[240px] flex-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
        value={value}
        placeholder={"espresso shot mirror 0.2 456 1879\nespresso mirror 0.49 1539 1155349\n\n或旧格式：\nespresso shot mirror\n0.63\n488\n1756622"}
        onChange={(event) => handleChange(event.target.value)}
      />
    </label>
  );
}

export function parseKeywordBulkText(value: string): TrialKeywordRow[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = lines.map(parseKeywordSingleLine);

  if (rows.every((row): row is TrialKeywordRow => Boolean(row))) {
    return rows;
  }

  // Preserve the legacy four-lines-per-keyword format when every metric line is numeric.
  const isLegacyFormat = lines.length > 0 && lines.length % 4 === 0 && Array.from({ length: lines.length / 4 }, (_, index) => {
    const offset = index * 4;
    return [lines[offset + 1], lines[offset + 2], lines[offset + 3]].every((line) => Number.isFinite(Number(line)));
  }).every(Boolean);

  if (isLegacyFormat) {
    return Array.from({ length: lines.length / 4 }, (_, index) => {
      const offset = index * 4;
      return {
        keyword: lines[offset],
        cpc: Number(lines[offset + 1]) || 0,
        monthlySearches: Number(lines[offset + 2]) || 0,
        abaRank: Number(lines[offset + 3]) || 0,
      };
    });
  }

  // Plain keyword input maps one non-empty line to one generated row.
  return lines.map((line, index) => rows[index] ?? ({ keyword: line, cpc: 0, monthlySearches: 0, abaRank: 0 }));
}

export function parseKeywordSingleLine(line: string): TrialKeywordRow | null {
  const parts = line.split(/\s+/);
  if (parts.length < 4) {
    return null;
  }

  const cpc = Number(parts.at(-3));
  const monthlySearches = Number(parts.at(-2));
  const abaRank = Number(parts.at(-1));
  if (![cpc, monthlySearches, abaRank].every(Number.isFinite)) {
    return null;
  }

  return {
    keyword: parts.slice(0, -3).join(" "),
    cpc,
    monthlySearches,
    abaRank,
  };
}

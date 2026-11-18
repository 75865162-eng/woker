"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, FileSpreadsheet, FileText, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import type { SkillView } from "@/lib/skill-engine/types";

type Props = {
  skills: SkillView[];
  categories: Array<{ id: string; label: string; count: number }>;
};

export function SkillsGallery({ skills, categories }: Props) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (category !== "all" && skill.category !== category) return false;
      if (!needle) return true;
      return `${skill.name} ${skill.summary} ${skill.slug}`.toLowerCase().includes(needle);
    });
  }, [skills, category, query]);

  return (
    <div className="space-y-[var(--gap-section)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Skill 名称、说明或 slug"
            className="erp-field w-full pl-9"
          />
        </div>
        <span className="text-meta text-muted">共 {skills.length} 个 Skill</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={`rounded-md border px-3 py-1.5 text-meta font-semibold transition-colors ${
              category === item.id
                ? "border-brand bg-brand text-white"
                : "border-border bg-surface text-muted hover:border-brand hover:text-foreground"
            }`}
          >
            {item.label} · {item.count}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Alert tone="info" title="没有匹配的 Skill" description="试试其他分类或搜索词。" />
      ) : (
        <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((skill) => (
            <Link
              key={skill.slug}
              href={`/skills/${skill.slug}`}
              className="group flex flex-col rounded-lg border border-border bg-surface p-4 shadow-sm transition-colors hover:border-brand"
            >
              <div className="flex items-start gap-2">
                <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <h3 className="min-w-0 flex-1 text-section font-semibold text-foreground">{skill.name}</h3>
                {skill.isNew ? <Badge tone="info">新</Badge> : null}
                {skill.featured && !skill.isNew ? <Badge tone="warning">精选</Badge> : null}
              </div>
              <p className="mt-2 line-clamp-3 text-body leading-6 text-muted">{skill.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{skill.categoryLabel}</Badge>
                {skill.exportFormat === "xlsx" ? (
                  <span className="inline-flex items-center gap-1 text-meta text-muted">
                    <FileSpreadsheet aria-hidden className="h-3.5 w-3.5" /> Excel
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-meta text-muted">
                    <FileText aria-hidden className="h-3.5 w-3.5" /> Word
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center justify-between pt-4 text-meta text-brand">
                <span>查看并运行</span>
                <ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

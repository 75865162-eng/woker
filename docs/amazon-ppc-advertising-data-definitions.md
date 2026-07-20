# Amazon PPC Advertising Data Definitions

## Purpose

This document is the canonical naming source for advertising data files in this project.

When a future feature, rule, parser, UI label, or document needs to introduce or reinterpret an advertising data source, confirm the definition with the product owner before implementing it.

## Canonical File Definitions

| Canonical name | User-facing meaning | Expected file | Role in workflow |
| --- | --- | --- | --- |
| `bulk` | Recent Advertising Data, the recent-period advertising workbook | `recent.xlsx` or equivalent uploaded recent advertising workbook | Main optimization source for current campaign/ad group rows, bids, status, and row-level export targeting |
| `overall` | All-date advertising data | `所有日期广告数据.csv` | Reference data for all-date performance context and rule conditions |

## Term Rules

- Use `bulk` only for the recent advertising workbook.
- Use `recent` as the normalized definition name for the recent advertising workbook when referring to the file definition itself.
- Use `overall` only for `所有日期广告数据.csv`.
- Do not use `Recent Advertising Data` to mean `overall`.
- Do not use `Overall` to mean the recent workbook.

## Current Implementation Compatibility Note

The application has been migrated so the all-date CSV is represented as `overall` in rule data sources, store state, and rule-engine context.

Legacy persisted workspace snapshots may still contain:

- `dataSource: "recent"`
- `recentAdDataRows`
- `recentAdDataStatus`
- `recentAdDataMatchSummary`

The workspace store migrates those legacy names to `overall` names during hydration.

`Bulk` / `bulk` may still appear in code and UI where it refers to the recent advertising workbook upload path. That is compatible with this document because `bulk` and `recent` both refer to the same recent workbook definition.

## Confirmation Requirement

If a future task finds ambiguous naming or needs a new advertising data source definition, stop and confirm:

- canonical name
- user-facing name
- file format
- role in rule evaluation
- whether it can be exported or is reference-only

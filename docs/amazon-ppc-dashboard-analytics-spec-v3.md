# Amazon PPC Optimization Workspace
## Dashboard and Analytics Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the dashboard and analytics layer for Amazon PPC Optimization Workspace Version 3.0.

It covers:

- dashboard positioning
- campaign-entry relationship with workspace home
- KPI dashboard requirements
- optimization opportunity views
- lifecycle analytics
- advanced filtering
- action-oriented analytics design

The goal is to make dashboard and analytics useful for prioritization and decision-making, not just reporting.

---

## 2. Design Goals

The dashboard and analytics system must achieve the following:

1. Help users decide where to work next.
2. Keep Campaign as the primary visible business object.
3. Reuse shared condition logic from the rule system where appropriate.
4. Support both high-level KPI monitoring and action-oriented prioritization.
5. Connect naturally into the `Campaign Grid Home` and campaign workspace flow.

---

## 3. Product Position

### 3.1 Dashboard Role

Dashboard is the strategic entry layer of the product.

It should answer questions like:

- which campaigns deserve attention now
- where ACOS risk is growing
- where growth potential exists
- which lifecycle groups need intervention
- how many actionable drafts may be waiting

### 3.2 Relationship to Workspace Home

Version 3.0 uses two closely related first-level surfaces:

- Dashboard
- Workspace Home

Dashboard is the broader analytical entry surface.

Workspace Home is the operational campaign grid entry surface.

They must feel like adjacent layers of the same system, not separate products.

### 3.3 Shared Entry Principle

Both Dashboard and Workspace Home should preserve a campaign-first experience built around:

- search
- lifecycle filtering
- sorting
- campaign cards or campaign summaries
- direct workspace entry

---

## 4. Experience Model

### 4.1 Official Dashboard Flow

```text
Open Dashboard
  -> Review KPI Summary
  -> Apply Filters
  -> Inspect Trends and Opportunity Queue
  -> Identify Priority Campaign
  -> Open Campaign Workspace
```

### 4.2 Relationship to Workspace Flow

```text
Dashboard
  -> Campaign Prioritization
  -> Open Workspace Home or Campaign Workspace
  -> Execute Optimization Work
```

### 4.3 Design Principle

Dashboard should lead to action.

It must not become a dead-end analytics page.

---

## 5. Dashboard Information Architecture

### 5.1 Primary Sections

Version 3.0 dashboard should support:

- KPI Summary
- Advanced Filter Panel
- Trend Visualization
- Opportunity Queue
- Lifecycle Insights
- Future campaign drill-down views

### 5.2 Current Implementation Mapping

Current dashboard already contains:

- KPI cards
- Advanced Filter Panel
- Sales / Spend trend chart
- optimization opportunity queue

This is a strong first iteration and should be extended rather than replaced.

### 5.3 Section Roles

Section responsibilities:

- KPI Summary: health overview
- Filter Panel: scoped analysis
- Trend Visualization: temporal pattern reading
- Opportunity Queue: action prioritization
- Lifecycle Insights: strategic segmentation

---

## 6. KPI Dashboard

### 6.1 Design Goal

KPI Dashboard gives users an immediate sense of overall account health.

### 6.2 Required KPI Blocks

Version 3.0 should include at least:

- total sales
- total spend
- ACOS
- total orders

Recommended extended metrics:

- ROAS
- impressions
- clicks
- CTR
- CVR
- draft count

### 6.3 Current Implementation Mapping

Current dashboard already computes and displays:

- total sales
- total spend
- ACOS
- total orders

### 6.4 Display Requirements

KPI cards should show:

- label
- main value
- optional delta
- clear scanability

### 6.5 UX Requirement

KPI cards should support fast reading in under a few seconds.

They must not require drill-down to be useful.

---

## 7. Trend Analytics

### 7.1 Design Goal

Trend analytics should reveal movement, not just snapshots.

### 7.2 Required Trend Views

Version 3.0 should at least support:

- sales trend
- spend trend

Recommended future overlays:

- ACOS trend
- orders trend
- lifecycle comparison trend

### 7.3 Current Implementation Mapping

Current dashboard already uses `TrendChart` for Sales / Spend trend visualization.

### 7.4 UX Requirement

Trend charts must be easy to read and secondary to action surfaces, not the only focal point.

---

## 8. Opportunity Queue

### 8.1 Design Goal

Opportunity Queue translates analytics into a ranked action list.

### 8.2 Business Role

It is not a report.

It is a prioritization engine surface.

### 8.3 Required Data Points

Each opportunity item should ideally show:

- campaign name
- issue or opportunity type
- supporting metric hint
- urgency or priority badge
- direct link into workspace

### 8.4 Current Implementation Mapping

Current dashboard already includes a basic opportunity queue with:

- campaign display
- keyword scan count
- issue badge examples such as high ACOS and low impressions

### 8.5 Future Extension

Future opportunity logic may include:

- rule hit likelihood
- anomaly scoring
- lifecycle deviation
- AI opportunity ranking

---

## 9. Lifecycle Analytics

### 9.1 Design Goal

Lifecycle analytics helps users understand strategy mix across campaign groups.

### 9.2 Required Views

Lifecycle analytics should support:

- campaign count by lifecycle
- spend by lifecycle
- sales by lifecycle
- ACOS by lifecycle
- draft volume by lifecycle

### 9.3 Relationship to Rule System

Because lifecycle determines rule loading, lifecycle analytics should also help users detect:

- under-assigned campaigns
- imbalanced lifecycle distribution
- poor-performing lifecycle groups

### 9.4 Future Extension

Future lifecycle analytics may include:

- lifecycle drift alerts
- lifecycle recommendation confidence
- lifecycle-based trend comparison

---

## 10. Advanced Filter Panel

### 10.1 Design Goal

The Advanced Filter Panel gives users reusable analytical query power without modifying data.

### 10.2 Shared Architecture

The filter panel must reuse the same condition-building language as the rule system wherever possible.

Shared layer:

- metric choice
- operator choice
- nested logic
- source choice

### 10.3 Behavior Difference

Filter behavior:

- returns scoped visibility
- does not produce drafts
- does not trigger write-back

Rule behavior:

- returns actions
- generates drafts

### 10.4 Current Implementation Mapping

Current code already states that the Advanced Filter Panel shares components with the rule editor and is view-only.

This should remain a formal product rule.

### 10.5 Interaction Requirements

The filter panel must support:

- expand and collapse
- condition editing
- reset
- apply filter

---

## 11. Campaign Grid Home Relationship

### 11.1 Design Goal

Dashboard and Workspace Home must reinforce the same campaign-first product model.

### 11.2 Required Relationship

Dashboard must not contradict the required Workspace Home layout:

```text
Toolbar
  -> Search
  -> Lifecycle Filter
  -> Sort
  -> View
Campaign Grid
  -> Campaign Card
```

Dashboard can be more analytics-heavy, but it should still guide users toward this entry model.

### 11.3 UX Requirement

Users should feel that:

- dashboard tells them what matters
- workspace home lets them enter work quickly

These two surfaces must feel continuous.

---

## 12. Data Sources

Dashboard analytics may be built from:

- metric snapshots
- campaign objects
- draft counts
- lifecycle assignments
- recent data summaries
- future rule execution summaries

### 12.1 Current Implementation Mapping

Current dashboard already uses:

- `campaignGroups`
- `metricSnapshots`

This is acceptable for version 3.0 and can later evolve into repository-driven data access.

---

## 13. Error and Empty States

### 13.1 Empty State

When no data exists, dashboard should guide users to:

- upload bulk file
- create campaign workspace data

### 13.2 Partial Data State

If some analytics are missing, the dashboard should still provide:

- available KPI summaries
- campaign access
- clear missing-data messaging

### 13.3 Error State

Errors should never strand the user.

Dashboard should still offer navigation into available workspaces whenever possible.

---

## 14. Performance Requirements

### 14.1 Core Requirement

Dashboard must remain fast and scannable even as campaign count grows.

### 14.2 Required Capabilities

Dashboard should support:

- fast KPI aggregation
- quick filter response
- scalable campaign lists or cards
- lightweight trend rendering

### 14.3 Recommended Direction

Recommended future optimizations:

- cached aggregate snapshots
- incremental recomputation
- virtualized long lists where needed

---

## 15. Future Extension

Future dashboard capabilities may include:

- anomaly center
- custom saved views
- AI opportunity ranking
- cross-lifecycle compare board
- cross-workspace alert center

---

## 16. Summary

Version 3.0 defines Dashboard as an action-oriented analytics layer tightly connected to the campaign-grid workspace model.

It is responsible for:

- summarizing account health
- prioritizing campaigns
- exposing reusable filters
- guiding users toward the right workspace actions

That makes analytics part of the operating workflow, not a disconnected reporting page.

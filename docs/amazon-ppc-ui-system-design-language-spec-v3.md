# Amazon PPC Optimization Workspace
## UI System and Design Language Specification
### Version 3.0

---

## 1. Document Purpose

This document defines the UI system and design language for Amazon PPC Optimization Workspace Version 3.0.

It covers:

- visual direction
- page structure principles
- layout system
- campaign grid home language
- component language
- color system
- typography
- spacing
- interaction tone

The goal is to make the product feel like a focused modern optimization workspace rather than a generic admin panel.

---

## 2. Design Goals

The UI system must achieve the following:

1. Feel professional, dense, and operational.
2. Keep Campaign, Workspace, Rule, and Draft visually legible as first-class objects.
3. Support fast scanning of metrics and statuses.
4. Preserve the `Campaign Grid Home` as a signature entry experience.
5. Avoid old tree-table enterprise UI patterns as the dominant visual language.

---

## 3. Visual Positioning

### 3.1 Product Feel

The product should feel closer to:

- Cursor
- Notion
- Pacvue

It should feel less like:

- legacy ERP screens
- spreadsheet wrappers
- boilerplate admin dashboards

### 3.2 Visual Character

The product should feel:

- structured
- clear
- sharp
- high-signal
- low-noise

### 3.3 Interaction Tone

The UI should communicate:

- confidence
- safety
- precision
- controllability

---

## 4. Experience Signature

### 4.1 Signature Surface

The signature surface of version 3.0 is the `Campaign Grid Home`.

It must preserve:

- top toolbar
- campaign grid
- campaign cards

This is the visual and interaction identity of the product.

### 4.2 Required Home Structure

```text
Toolbar
  -> Upload Bulk
  -> Search
  -> Lifecycle Filter
  -> Sort
  -> View

Campaign Grid
  -> Campaign Cards
```

### 4.3 Design Requirement

Detailed workspaces, rules, and drafts expand from this home.

They do not replace this home as the first-level visual model.

---

## 5. Layout System

### 5.1 App Shell

The app shell should provide:

- fixed left navigation
- stable top header
- spacious but dense content area

### 5.2 Current Implementation Mapping

Current `AppShell` already provides:

- fixed 76px left nav
- sticky top header
- content padding

This is aligned with version 3.0 and should be retained as the structural base.

### 5.3 Layout Principles

Layout should prioritize:

- stable framing
- low layout shift
- predictable entry points
- strong content grouping

### 5.4 Page-Level Layout Types

The system should support these major layout types:

- Dashboard layout
- Workspace Home layout
- Active Workspace layout
- Rule Center layout
- Settings layout

---

## 6. Campaign Grid Home Design

### 6.1 Design Goal

Workspace Home should immediately communicate that Campaign is the primary operating object.

### 6.2 Toolbar Language

Toolbar should contain actions and filters such as:

- Upload Bulk
- Search
- Lifecycle Filter
- Sort
- View

### 6.3 Campaign Grid Language

Campaign Grid should:

- use cards as primary units
- show important summary metrics
- support fast scanning
- avoid table-first framing

### 6.4 Campaign Card Language

Campaign cards should highlight:

- campaign name
- lifecycle badge
- ACOS
- orders
- draft count where available
- freshness signals

### 6.5 Card Feel

Cards should feel like actionable objects, not passive report tiles.

---

## 7. Color System

### 7.1 Design Goal

Color should support readability, information hierarchy, and operational tone.

### 7.2 Current Token Set

Current theme tokens already define:

- Background: `#F6F7F9`
- Foreground: `#111827`
- Surface: `#FFFFFF`
- Surface Muted: `#EEF2F5`
- Border: `#D9E0E7`
- Muted: `#667085`
- Brand: `#176B87`
- Brand Dark: `#0F4D63`
- Accent: `#F59E0B`
- Success: `#16A34A`
- Danger: `#DC2626`
- Info: `#2563EB`

### 7.3 Usage Principles

Color usage should follow:

- brand for primary interaction and emphasis
- muted surfaces for grouping
- low-saturation badges for status
- success / danger / info for semantic signals

### 7.4 Lifecycle Color Language

Lifecycle visual tones should remain distinct but controlled:

- launch: blue family
- mature: green family
- decline: amber family
- clearance: red family

---

## 8. Typography System

### 8.1 Design Goal

Typography should support dense information scanning without feeling cramped.

### 8.2 Current Font Mapping

Current implementation uses:

- Geist Sans
- Geist Mono

These are acceptable for version 3.0.

### 8.3 Recommended Scale

Recommended scale:

- Page Title: 28 / 36 / 700
- Section Title: 18 / 28 / 650
- Card Title: 14 / 20 / 700
- Body: 14 / 22 / 400
- Caption: 12 / 18 / 500

### 8.4 Numeric Typography

Metric-heavy UI should use:

- tabular numerals
- consistent decimal presentation
- strong size contrast for primary KPI values

Current `.metric-tabular` utility should remain part of the UI system.

---

## 9. Spacing and Density

### 9.1 Design Goal

Spacing should feel deliberate and efficient, not oversized or cramped.

### 9.2 Recommended Scale

Primary spacing scale:

- 4
- 8
- 12
- 16
- 20
- 24
- 32
- 40

### 9.3 Density Principle

This product should prefer high information density with strong grouping rather than oversized marketing-style spacing.

---

## 10. Component Language

### 10.1 Core Component Families

Version 3.0 should emphasize:

- campaign cards
- KPI cards
- badges
- filter panels
- tab bars
- draft tables
- rule blocks
- charts

### 10.2 Card Principles

Cards should be used for:

- KPI summaries
- campaign summaries
- opportunity items
- rule summaries

Cards should not be nested unnecessarily.

### 10.3 Badge Principles

Badges should communicate:

- lifecycle
- risk level
- trend direction
- status

They should remain low-noise and easy to scan.

### 10.4 Table Principles

Tables are still important for detailed review, especially for drafts and entities.

But tables are second-level interaction surfaces, not the dominant first impression of the product.

### 10.5 Filter Panel Principles

Filter panels should feel like structured work tools, not giant forms.

### 10.6 Rule Builder Principles

Rule builder UI should visually separate:

- IF logic
- THEN actions
- preview outputs

---

## 11. Navigation Language

### 11.1 Left Navigation

The left rail should remain icon-led, compact, and persistent.

Primary destinations:

- home
- dashboard
- workspace
- rules
- settings

### 11.2 Top Header

Top header should present:

- page identity
- subtitle context
- data date or freshness
- future engine status
- account marker

### 11.3 Navigation Tone

Navigation should feel stable and understated.

The product's visual focus belongs to campaign and workspace content, not chrome.

---

## 12. Data Visualization Language

### 12.1 Design Goal

Charts and metrics should support decisions, not become decoration.

### 12.2 Chart Principles

Charts should:

- use restrained color palettes
- prioritize readability
- highlight business movement
- stay secondary to direct action surfaces

### 12.3 KPI Principles

KPI values should:

- emphasize main number
- keep labels concise
- use deltas sparingly but clearly

---

## 13. Motion and Interaction Feedback

### 13.1 Design Goal

Interaction feedback should help orientation and trust without feeling flashy.

### 13.2 Recommended Motion

Appropriate motion includes:

- subtle hover feedback
- tab activation transitions
- panel expand / collapse
- loading progress transitions

### 13.3 Avoid

Avoid:

- excessive bounce
- decorative motion with no information value
- high-latency animations on dense work surfaces

---

## 14. Empty, Loading, and Error Design

### 14.1 Empty States

Empty states should guide users toward:

- upload
- campaign selection
- lifecycle assignment
- recent data upload

### 14.2 Loading States

Loading states should feel precise:

- parsing
- restoring
- saving
- running rules
- exporting

### 14.3 Error States

Error states should be:

- contextual
- concise
- actionable

---

## 15. Accessibility and Readability

### 15.1 Core Requirement

The UI must maintain strong readability in dense information layouts.

### 15.2 Requirements

The design should support:

- strong contrast
- clear focus targets
- readable small text
- stable keyboard-targetable controls where possible

### 15.3 Numeric Readability

Metric-heavy areas must avoid visual jitter and inconsistent numeric formatting.

---

## 16. Future Extension

Future UI extensions may include:

- split workspace views
- AI copilot panel
- simulation side sheet
- saved dashboard views
- collaborative review indicators

---

## 17. Summary

Version 3.0 defines a UI language centered on:

- campaign-grid entry
- dense but clear operational surfaces
- restrained professional styling
- strong metric readability
- modern workspace framing

This design language is what makes the product feel intentional, software-like, and different from a spreadsheet wrapper.

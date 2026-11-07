# Implementation Plan: Skill ERP MCP Tool Catalog

**Branch**: `006-skill-erp-mcp-tool-catalog` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-skill-erp-mcp-tool-catalog/spec.md`

## Summary

Remove the duplicated UI-owned MCP tool catalog. Render the tool catalog and credential choices from the existing protected settings API response so newly registered tools remain visible without changing server authorization behavior.

## Technical Context

**Language/Version**: TypeScript, React 19

**Primary Dependencies**: Next.js App Router, React, Playwright

**Storage**: No changes

**Testing**: Isolated Playwright browser fixture and TypeScript

**Target Platform**: Existing web settings page

**Project Type**: Web application

**Performance Goals**: No additional network requests; reuse the existing settings API request

**Constraints**: Preserve current credential scopes and server-side tool grants; no external API calls or database changes

**Scale/Scope**: Skill / ERP settings tool catalog and its browser regression fixture only

## Constitution Check

- Reuse the existing settings API and UI component; no new service or data model.
- Preserve explicit grants, seller/site scope, and existing credential lifecycle behavior.
- Use fixture data only; no production credentials or Amazon network access.

## Project Structure

```text
src/components/settings/skill-erp-settings-panel.tsx
src/components/operations/amazon-mcp-panel.tsx
tests/browser/amazon-multistore.spec.ts
```

**Structure Decision**: Keep the feature in the existing settings and credential panel components and extend the isolated browser regression that already covers credential lifecycle.

## Complexity Tracking

No constitution violations or new abstractions are required.

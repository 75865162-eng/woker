# Feature Specification: Skill ERP MCP Tool Catalog

**Feature Branch**: `006-skill-erp-mcp-tool-catalog`

**Created**: 2026-11-06

**Status**: Implemented and validated

**Input**: User request: Continue upgrading the Skill and ERP MCP integration.

## User Scenarios & Testing

### User Story 1 - See and authorize the current MCP tools (Priority: P1)

An ERP operator opens Skill / ERP settings and sees the same MCP tool names and descriptions that the server currently offers for credential authorization. The operator can select supported tools without relying on a second, manually maintained list.

**Why this priority**: A stale settings catalog can hide delivered capabilities or mislead operators about what a new credential can use.

**Independent Test**: Load the settings panel with a fixture tool registry containing standard and Ads tools; verify the catalog and credential checkboxes reflect that registry.

**Acceptance Scenarios**:

1. **Given** the server returns `amazon.ads.entities.list` and `amazon.ads.reports.list`, **When** an operator opens Skill / ERP settings, **Then** both tools and their descriptions are visible and selectable.
2. **Given** the server tool registry changes, **When** the settings panel reloads, **Then** its displayed catalog and selectable tools reflect the new response without a separate UI catalog edit.
3. **Given** the registry is empty, **When** the settings panel loads, **Then** it displays an explicit empty state and does not offer stale tool checkboxes.

### Edge Cases

- The API returns malformed or absent tool metadata; the settings panel must fail visibly and must not silently substitute a different local list.
- A new read-only tool requires a separate credential grant; showing it in the catalog must not grant it to existing credentials.

## Requirements

### Functional Requirements

- **FR-001**: The settings page MUST display tool names and descriptions from the current server-provided MCP registry.
- **FR-002**: Credential creation MUST offer only tools from that same server-provided registry.
- **FR-003**: Registry display MUST remain informational; it MUST NOT change existing credential grants or access checks.
- **FR-004**: The settings page MUST display an explicit empty state when the registry contains no tools.
- **FR-005**: Existing credential scope, expiry, rotation, disable, revoke, and one-time token display behavior MUST remain unchanged.

### Key Entities

- **MCP Tool Registry Entry**: A server-supported tool name and its operator-facing description.
- **MCP Credential**: An operator-created credential whose selected tool grants and seller/site scopes remain explicit.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of tools returned by the settings API appear in both the visible catalog and credential tool selection.
- **SC-002**: The visible list and selectable list have identical tool names after initial load and reload.
- **SC-003**: Existing credential lifecycle regression tests continue to pass without changes to grant semantics.

## Assumptions

- The protected settings API remains the source of the current tool registry.
- Credential grants continue to be enforced by the server and require no client-side authorization changes.
- This change does not activate upstream Amazon requests or alter stored credentials.

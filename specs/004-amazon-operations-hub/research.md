# Research: Amazon Operations Hub

## Decision: Separate non-secret connection metadata from future credentials

**Rationale**: The MVP must make readiness visible without exposing or persisting SP-API credentials. Credential storage needs a dedicated encrypted secret-management design.

**Alternatives considered**: Browser-local settings were rejected because they are neither auditable nor safe for organization-wide synchronization.

## Decision: Reuse organization and workspace scope

**Rationale**: Existing route permission and workspace-scope helpers enforce the ERP's established tenant boundary.

**Alternatives considered**: A standalone Amazon account selector was rejected because it risks a second, inconsistent scope model.

## Decision: Persist blocked sync requests

**Rationale**: Operators need evidence that a request was intentionally prevented, and future workers need a consistent run ledger.

**Alternatives considered**: Returning a transient error was rejected because it loses operational auditability.

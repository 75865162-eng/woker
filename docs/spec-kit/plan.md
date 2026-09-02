# Plan

## Architecture

- UI layer
- API layer
- Domain layer
- Storage layer
- Job / worker layer
- Audit / logging layer

## Implementation Steps

1. Define or adjust the data model.
2. Extract domain rules into pure functions.
3. Add API routes or service methods.
4. Build the UI flow.
5. Add audit and error handling.
6. Add tests.
7. Verify rollback and compatibility.

## File Impact

- List the files to add.
- List the files to modify.
- List the files to keep untouched.

## Data Migration

- New tables or columns
- Backfill strategy
- Compatibility with existing records

## Testing Plan

- Unit tests for rules and validators
- Integration tests for API and storage
- Manual validation for the main workflow

## Rollback Plan

- Code rollback path
- Data rollback or forward-fix path
- User-visible recovery behavior

## Release Notes

- What changed
- What remains unchanged
- Any user action required

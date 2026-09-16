# Data Model: SKU Thumbnail Lazy Load

## Entities

### Product List Row

- **Purpose**: Represents one product row in the dashboard list.
- **Key fields**: SKU, display name, summary values, thumbnail image reference, fallback image state.
- **Relationships**: Points to a SKU Detail View when opened.
- **Validation rules**: Must always be renderable even if the product has no images or the detail payload is still loading.

### SKU Detail View

- **Purpose**: Represents the full product view opened from the list.
- **Key fields**: SKU, editable product fields, rich imagery, heavy nested content, loading state.
- **Relationships**: Loaded from the selected Product List Row.
- **Validation rules**: Must open as a usable shell before heavy content finishes loading.

### Image Content Tier

- **Purpose**: Distinguishes lightweight thumbnail presentation from heavier detail imagery.
- **Key fields**: tier name, source content, display target, loading priority.
- **Relationships**: Applies to both list rows and SKU detail views.
- **Validation rules**: Thumbnail tier must be available first; rich tier may arrive later.

## State Transitions

1. List row is available with thumbnail tier only.
2. User selects a SKU.
3. SKU detail shell opens immediately.
4. Heavy image/content tier loads after entry.
5. Detail view upgrades in place once content is available.

## Notes

- No persisted schema changes are required.
- The feature is a presentation and loading-order change, not a data migration.

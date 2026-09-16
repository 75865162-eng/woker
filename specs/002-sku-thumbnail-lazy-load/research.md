# Research: SKU Thumbnail Lazy Load

## Decision 1: Keep the list lightweight and defer heavy content

- Decision: The dashboard list should show thumbnail-sized imagery and summary fields only, while larger images and rich nested product content load after a SKU is opened.
- Rationale: This directly improves perceived speed on the highest-traffic surface without changing persisted product data.
- Alternatives considered: Loading the full product payload in the list, or preloading all rich content for every visible row.

## Decision 2: Preserve the existing SKU detail entry point

- Decision: The current SKU detail view should remain the entry point for rich content, with a usable shell shown before heavy content finishes loading.
- Rationale: This keeps the user flow familiar and limits the scope of the change to loading order and presentation.
- Alternatives considered: Splitting the detail experience into a separate route, or redesigning the workbench layout.

## Decision 3: Reuse existing product caching behavior where possible

- Decision: The feature should benefit from the current product list and per-SKU in-memory cache patterns instead of introducing a new persistence layer.
- Rationale: The problem is perceived latency, not long-term data durability, so transient caching is enough for v1.
- Alternatives considered: Adding a new database table or storage layer for thumbnails and detail tiers.

## Decision 4: Treat missing images as a normal fallback state

- Decision: Products without images should render a stable placeholder in the list.
- Rationale: The list must remain scannable even when image content is incomplete.
- Alternatives considered: Hiding image cells for missing media or waiting for image availability before rendering the row.

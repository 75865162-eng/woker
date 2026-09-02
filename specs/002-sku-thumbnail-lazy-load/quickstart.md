# Quickstart: SKU Thumbnail Lazy Load

## Goal

Verify that the dashboard list stays fast with thumbnails, and that heavy SKU content appears only after a SKU is opened.

## Prerequisites

- Local development environment is available.
- Product dashboard data exists with at least one SKU that has images and one SKU that has heavier detail content.

## Validation Steps

1. Open the dashboard list.
2. Confirm the list becomes visible with thumbnail-sized images.
3. Confirm the list is usable before any large image content is needed.
4. Open a SKU from the list.
5. Confirm the detail shell appears first.
6. Confirm larger images and richer content arrive after the shell is visible.
7. Reopen the same SKU during the same session and confirm already loaded content is reused when available.
8. Test a product without images and confirm a stable fallback thumbnail appears.

## Expected Outcome

- List browsing stays responsive.
- SKU detail opens without blocking on heavy imagery.
- Missing-image products still render cleanly.
- Reopening a SKU does not feel like a full cold load when content is already available.

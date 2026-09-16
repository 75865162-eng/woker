# Production data persistence plan

This project should treat PostgreSQL as the source of truth for business data. Browser storage may be used only as short-term UI cache or draft acceleration.

## Interface defaults

- List endpoints must support `page`, `pageSize`, `search`, and status-style filters from the start.
- List endpoints should return only summary fields needed by the table.
- Detail endpoints should fetch the full payload, images, files, history, and large nested data after the user opens a record.
- Uploads and exports must write binary objects through the storage adapter and store metadata in `FileObject`.
- Slow imports, exports, and AI processing should be represented by job records so the processing path can move to a worker later.
- Product records, Listing drafts, PPC drafts, AI settings, files, and jobs should emit version records for audit and rollback.

## Current implementation status

- Account roles, permission matrix, member roster, WeCom settings, AI settings, Listing AI workspace/chat history, file jobs, import jobs, and export records are database-backed.
- Product list loading now uses `/api/products?page=&pageSize=&search=&status=` and returns lightweight list rows.
- Product detail loading now uses `/api/products/[sku]` to fetch the full product payload only when opening a SKU.
- Product images are uploaded through `FileObject` plus the storage adapter via `/api/products/image-assets/upload`; product payload stores the thumbnail URL for first paint and keeps the original asset URL for preview. Historical inline `data:image/...` payloads can be backfilled with `npm run products:backfill-image-assets`.

## Next priorities

1. Move product import/export execution behind job records instead of doing large workbook parsing in the page request.
2. Split PPC workspace snapshots into database workspace versions and draft records while keeping IndexedDB as local recovery cache only.
3. Replace remaining local-only trial product drafts with database-backed draft records.
4. Add focused API tests for product pagination, filtering, detail loading, and file-backed image uploads.

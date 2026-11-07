# Amazon Catalog Image Assets

Online product thumbnails are derived from published Amazon `catalog_items` observations, with `listing_details` summaries as a fallback when Catalog Items has no main image. The image backfill does not call SP-API. It downloads only HTTPS image URLs from the Amazon image CDN allowlist and stores a 150 x 150 WebP derivative through the configured storage adapter.

Image bytes are content-addressed and unique within an organization/workspace. `AmazonCatalogImageReference` maps seller, marketplace, ASIN and MAIN variant to the shared blob. Repeated SKUs for the same ASIN therefore use the same reference; identical image content across ASINs or sites reuses the same stored object. Amazon observations and `ProductRecord` are not modified.

The runner is limited to the reviewed local `amazon-live-local/default` database and local storage. It verifies all four current catalog snapshots and the eight configured detail sources. Only complete, successful published detail runs bound to the current catalog heads are eligible; unfinished sources stay pending while completed sources can be backfilled independently. Missing coverage is reported explicitly, never treated as a successful full collection. The preview reports aggregate counts only:

```bash
npm run amazon:images:preview
```

Apply downloads missing or changed main images, writes the WebP files and upserts references. A rerun resumes from existing references and content hashes:

```bash
npm run amazon:images:apply
```

Each source download is capped at 15 MB, has a 20-second timeout, rejects redirects, validates raster image content, limits decoded pixels, and writes a maximum 1 MB thumbnail. Failures are logged with a hashed product key and can be retried. Rows with no main-image URL in either published API observation remain listed in the aggregate `missingImageMetadata` count.

For the approved initial collection, a bounded foreground follow mode checks the existing detail publications every 30 seconds and backfills newly completed sources:

```bash
npm run amazon:images:apply -- --follow
```

It does not create API tasks, change schedules, restart workers, or retry failed detail tasks. It stops after two hours or when no unpublished source has an active task, returning exit code 3 if any source remains unpublished. It is a resumable CLI process, not a durable registered worker or a recurring automation. Restart the same command after an interruption. Only one image runner should be used at a time. `pendingMetadata` means no detail source for that seller/site has published; `noImageInPublishedSources` means the currently published sources contain no permitted main-image URL, which can still change when the other API publishes.

Reference writes recheck the configured authorization revision and the source publication head. Original images exist only in bounded process memory; stored files are WebP derivatives. URL reuse avoids repeat downloads and the unique organization/workspace/content hash reuses identical normalized bytes even when source URLs differ. Changing the chosen source rendition may generate different normalized bytes; older unreferenced objects are retained until a separately approved cleanup.

The database migration is additive. Rollback should disable the UI read path while retaining image references and files; deletion or storage cleanup requires a separate reviewed operation. Future catalog refreshes do not automatically fetch changed images; rerun the preview and apply after a new complete detail publication.

## Local execution evidence — 2026-11-07, Beijing time

The user separately approved the preceding additive Sellfox order/FBA snapshot migration. Both `20261106140000_sellfox_order_and_fba_shipment_snapshots` and `20261107010000_amazon_catalog_image_assets` finished on the reviewed local database. No Sellfox API collection was started by this image task. No server, configuration, production data, commit or push was changed by this task.

At 03:10, the current four-site catalog scope was 675 SKUs / 665 site-ASINs. Brazil Catalog Items (114 observations) and Mexico Listings Items (165 observations) were published. There were 271 persisted image references: Brazil 112 and Mexico 159. They referenced 225 distinct current blobs, saving 46 duplicate references. All 311 retained files, including 86 superseded unreferenced renditions, passed SHA-256, WebP, 150×150, and file-status checks; total stored size was 1,165,274 bytes. Preview showed zero pending downloads for the published candidates. These are timestamped observations, not a full-collection claim.

387 site-ASINs still awaited a published detail source; seven had no image in the then-published sources. Mexico Catalog Items failed on an upstream HTTP 404 after 11 successful objects, so its partial staging data was not published or consumed. Other API jobs remained queued/running. The bounded follow process was started at 03:11 to persist newly published detail sources without changing their limits or retries. Log: local temporary `/tmp/amazon-catalog-images-follow.log`; terminal session lifetime is not a recovery guarantee.

Validation: `check:fast` passed 1,093 core tests, lint (zero errors, seven warnings), and TypeScript before the final narrow fixes. Afterwards, five image unit tests, two isolated browser regressions (unknown values and 150px shared-image URLs), targeted lint, TypeScript, and `git diff --check` passed. Both migration SQL files were tested on disposable fixture PostgreSQL before local apply. Real database reads returned persisted image URLs and titles. An unauthenticated visit to localhost:3017 redirected to login; authenticated HTTP image delivery and full live-page visual acceptance remain unverified. No production build, full E2E, server validation or production deployment was run.

## Online product read repair — 2026-11-07 03:22, Beijing time

The authenticated localhost:3017 web process returned HTTP 500 because its global cached Prisma Client predated the image models; the image reference delegate was undefined. A fresh CLI client could read the same database successfully. The image column was still in the component, but rows could not load.

Image reference and file-access reads now use a narrow parameterized repository over the existing tables and cached connection, avoiding new-model delegates without restarting any process. Organization/workspace, authorized seller/site, MAIN variant and FileObject boundaries remain explicit. The image route uses the same repository. Client reload clears stale error state; product-route logs include error name/code only, without raw business data. No real configuration/data changes, API collection, migration, restart, commit, push or deployment were performed for this repair.

Authenticated Chrome verification showed the live online-products table, main-image column, titles and inventory. The actual products request and image requests returned HTTP 200; the screenshot visibly showed loaded thumbnails. Read-only database checks confirmed accessible image reads succeed and an unrelated seller/site receives no image. Some rows still lack images because collection coverage is incomplete; this is separate from the fixed 500.

Validation: check:fast passed 1,094 tests, lint zero errors/seven warnings, TypeScript; seven targeted image tests (including a cached-client fixture with no new model delegates and parameterized access scopes) and two isolated browser regressions passed; diff whitespace check passed. No full production build or full E2E was run because no deployment/build/runtime configuration changed. Rollback can restore the former image-read repository after refreshing the web Prisma Client; existing objects and references must be retained.

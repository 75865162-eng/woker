# Product Image Signed URLs

Product list thumbnails and product-editor images use `POST /api/products/image-urls` to obtain short-lived object URLs. The endpoint requires the normal `products:view` permission and only signs `FileObject` records in the current organization, workspace, and selected account scope.

- R2/S3 URLs expire after 10 minutes. The UI batches visible thumbnail requests and renews once after an image load failure.
- `STORAGE_DRIVER=local` intentionally retains `/api/assets/*` as a development fallback because local files have no browser-reachable object host.
- `/api/assets/*` is retained for legacy product image references and is marked deprecated for product assets. New R2/S3 product-image rendering must not proxy object bytes through Next.js.

Before production rollout, configure the R2/S3 bucket CORS policy to allow `GET` and `HEAD` from `https://aecob.com` (and the intended staging origin). Do not make the bucket public: browser access is granted only through an expiring signed URL.

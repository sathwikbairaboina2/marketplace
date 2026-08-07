# Product image upload to S3

**Date:** 2026-08-07
**Status:** approved, not yet implemented

## Purpose

Let an admin attach photographs to a product from the browser console.

Every product in the system currently has an empty `images` array. The contract
has always allowed images — `CreateProductSchema` declares
`images: z.array(z.string().url()).max(20)` — but nothing has ever populated it,
because there is no way to get a file from a person's disk to a URL the platform
can serve.

This is the first of two specs. A visual redesign of the console follows
separately; it is written to work with or without real photography, and this
work is what makes the difference between a product grid of grey placeholders
and one of actual products.

## Current state

- `CreateProductSchema` accepts `images: string[]`, each a valid URL, at most 20.
  `ProductRecord.images` stores them. No UI writes to it and no product has a
  non-empty array.
- **The engine has no update routes.** There is no `PATCH /products/:id`, so an
  image cannot be attached to a product that already exists.
- LocalStack runs in the compose stack with `SERVICES: sqs`. Its healthcheck
  greps the health endpoint for `"sqs": "(available|running)"`.
- `docker/seed/` creates infrastructure and writes the resulting identifiers to
  `docker/.env.generated`, which the engine, agents and web containers read.
  `ensureQueues()` in `sqs.ts` is the pattern a bucket follows.
- The seed already solves the host/internal endpoint split for Cognito: it
  writes `COGNITO_ENDPOINT_HOST` (`http://localhost:9229`, for callers on the
  host) beside `COGNITO_ENDPOINT` (`http://cognito-local:9229`, for callers
  inside the network), because a token's `iss` must match what the verifier
  expects.
- The engine's `CORS_ORIGINS` already allows `http://localhost:3002`, but that
  governs the engine's own responses and has nothing to do with S3.

## Approach

Upload goes **directly from the browser to S3** using a presigned POST that the
engine signs. The bytes never pass through the API.

### Why presigned POST rather than PUT or a proxy

A presigned **PUT** is simpler to generate and to call, but its signature covers
no conditions on the body: there is no way to bound the size. The engine would
have to accept a client-declared length, which is not a limit — it is a request
that the client behave. A presigned **POST** signs a policy, and the policy can
pin both `content-length-range` and an exact `Content-Type`, so **S3 rejects an
oversized or wrong-typed upload itself**. The enforcement lives in the storage
layer, where it cannot be talked out of.

Proxying the upload through the engine (multipart to
`POST /products/:id/images`) would give the strongest validation of all, since
the engine would see the real bytes, and would avoid both bucket CORS and the
signing-host problem below. It was rejected because it puts user-controlled file
bytes through the API process — a request-size limit to tune, upload duration
competing with API latency, and multer to configure — to buy validation that a
signed policy already provides.

### Upload first, then create

Because the engine has no update routes, the order is forced:

1. The admin picks files in the product form.
2. The browser requests one presigned POST per file.
3. The browser posts each file straight to S3.
4. The form holds the resulting object URLs.
5. Submitting the form creates the product with those URLs in `images`.

**Images can therefore only be set when a product is created.** Changing the
images on an existing product is not possible and is out of scope; it becomes
possible when update routes exist, and needs no change here when they do.

### The signing host, which is the thing most likely to go wrong

A presigned URL's signature is bound to the host it was signed for. The engine
reaches LocalStack at `http://localstack:4566`; the browser must use
`http://localhost:4566`. Signing with the internal hostname produces a URL that
fails its signature check from the browser rather than failing to resolve, so it
presents as an opaque 403 rather than a connection error.

The engine therefore signs with a **host-facing** endpoint, configured
separately from the one it uses for its own S3 calls. This mirrors
`COGNITO_ENDPOINT_HOST` exactly, and for the same underlying reason: an
identifier minted for one audience is being consumed by another.

`forcePathStyle: true` on the S3 client — LocalStack serves
`http://localhost:4566/<bucket>/<key>`, not virtual-host addressing.

### Object keys and access

Keys are `<tenantId>/products/<uploadId>/<sanitised-filename>`, where
`uploadId` is a fresh ULID. It is not the product id: the product does not exist
yet at upload time.

Objects are **public-read**. Product photographs exist to be displayed, and
minting a signed read URL per thumbnail would cost a round-trip per image on
every grid, defeat browser and CDN caching, and require the app to have fetched
a URL before any `<img>` could render. The consequence, stated plainly: tenant
isolation does not extend to the object URL. Anyone holding the URL can load the
image. There is no listing and no enumeration, but there is no access check
either.

The tenant prefix is nonetheless part of the key, so a tenant-checked read path
remains a policy change rather than a data migration.

### Components

**`apps/engine/src/uploads/`** — a new module, one endpoint:

`POST /api/v1/uploads/product-image`, authenticated like every other route.

- Request: `{ filename: string, contentType: string }`
- Response: `{ url: string, fields: Record<string, string>, objectUrl: string }`

`contentType` outside `image/jpeg`, `image/png`, `image/webp`, `image/gif` is
rejected with a 422 problem **before** anything is signed. The signed policy
pins `content-length-range` to `0..MAX_IMAGE_BYTES` and the exact content type.
`filename` is sanitised to a safe basename; a caller cannot use it to escape the
key prefix.

**Configuration** — new env on the engine: `S3_BUCKET`, `S3_ENDPOINT`
(internal), `S3_PUBLIC_ENDPOINT` (host-facing, used for signing and for building
`objectUrl`), `MAX_IMAGE_BYTES` (default 5 MB). The module registers only when
`S3_BUCKET` is set, so an engine without object storage configured behaves
exactly as it does today.

**Infrastructure** — `SERVICES: sqs,s3` in `docker-compose.yml`, and the
LocalStack healthcheck extended to require s3 as well. Without that, the engine
can start against a LocalStack that is answering for SQS but not yet for S3.

**`docker/seed/s3.ts`** — `ensureBucket()`, called from `seed.ts` beside
`ensureQueues()`. Creates the bucket, applies a public-read bucket policy, and
sets a CORS rule permitting `POST` and `GET` from `http://localhost:3002`.
Writes `S3_BUCKET` to `.env.generated`.

**`apps/web`** — `lib/api/uploads.ts` for the presign call and the S3 post, and
an `ImageUploader` component in the admin product form: file picker, per-file
progress, thumbnail preview, remove-before-submit, inline per-file errors.

Product images render with a plain `<img>` and explicit dimensions, not
`next/image`. The optimiser requires a `remotePatterns` allow-list that fails
confusingly for user-supplied hosts, and buys little for images whose dimensions
we already control.

### Failure handling

- **Wrong type** — 422 from the engine before signing, shown against the file.
- **Oversize** — rejected by S3 under the policy. S3 answers with an XML error
  body, which is mapped to a readable message rather than surfaced raw.
- **Upload failure** — that file is marked failed and can be removed or retried;
  the rest of the form stays usable.
- **Orphaned objects** — a file uploaded before a product create that then fails
  stays in the bucket. Accepted deliberately: reaping them is real work
  (lifecycle rules, or a sweep correlating keys against products) for a
  development stack whose bucket is discarded on every `docker:down`.

## Testing

**Unit** — key construction and filename sanitisation, including attempts to
traverse out of the prefix; content-type acceptance and rejection; the web
client's mapping of an S3 XML error to a readable message.

**Integration, against LocalStack** — presign, then actually upload the bytes
and read the object back. Assert that an oversized body and a mismatched content
type are both rejected **by S3**, not by the test's own arithmetic: that is the
claim the whole approach rests on, and asserting it anywhere else proves
nothing.

**End to end** — an admin creates a product with an uploaded image and the image
renders on the product detail page.

## Out of scope

- Changing the images on an existing product. Blocked on update routes.
- Image resizing, thumbnail generation, format conversion, and CDN delivery.
- Reaping orphaned objects.
- Uploads for any entity other than Product.
- Real AWS S3 deployment. The bucket lives in LocalStack; nothing here assumes
  otherwise beyond the endpoint being configurable.

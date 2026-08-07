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

The browser posts the file to the **engine**, which validates the bytes and
writes the object to S3 with its own credentials.

### Why a proxy rather than a presigned upload

This reverses an earlier decision, on evidence.

The original design had the browser upload directly to S3 under a presigned
POST, on the grounds that the signed policy can pin `content-length-range` and
an exact `Content-Type`, so **S3 itself** would reject an oversized or
wrong-typed file — enforcement in the storage layer, where a client cannot talk
it out of anything. That is true of real AWS S3.

It is not true of LocalStack, which is the only environment this platform is
verified in. Measured directly against the running stack:

| Upload | Result |
|---|---|
| Valid signature, 4 KB body against a 1 KB policy limit | 204 |
| **Tampered** signature (`X-Amz-Signature: deadbeef`) | 204 |
| **No policy or signature fields at all** | 204 |

The policy was generated correctly — decoded, it carried both conditions,
signed. LocalStack simply does not validate presigned POSTs. So the size and
type limits were unenforced locally, and worse, the bucket was writable by
anything that could reach the port, with no credential at all.

A security control that cannot be exercised in the environment the project
tests in is not a control. Proxying through the engine gives enforcement that
does not depend on the storage backend: the engine holds the actual bytes, so it
can check the real length and read the file's magic number rather than trusting
the declared type. It also removes the need for bucket CORS and for any
public-write path.

The costs are real and accepted: multipart handling in NestJS, and up to
`MAX_IMAGE_BYTES` per request passing through the API process. At a 5 MB cap
for product photographs that is a reasonable amount of work for the API to do.

A presigned **PUT** was never viable — its signature covers no conditions on the
body, so the size limit would have been a request that the client behave.

### Upload first, then create

Because the engine has no update routes, the order is forced:

1. The admin picks files in the product form.
2. The browser posts each file to the engine as multipart form data.
3. The engine validates it and writes the object to S3.
4. The form holds the object URLs the engine returns.
5. Submitting the form creates the product with those URLs in `images`.

**Images can therefore only be set when a product is created.** Changing the
images on an existing product is not possible and is out of scope; it becomes
possible when update routes exist, and needs no change here when they do.

### Two endpoints, still

The engine *writes* to S3 over the internal endpoint (`http://localstack:4566`),
but the URL it stores must be one a **browser** can fetch
(`http://localhost:4566`). So both are configured, for the same underlying
reason as `COGNITO_ENDPOINT` and `COGNITO_ENDPOINT_HOST`: a value produced for
one audience is consumed by another.

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

`POST /api/v1/uploads/product-image`, authenticated like every other route,
accepting `multipart/form-data` with a single `file` part.

- Response: `{ objectUrl: string }`

Three checks, all on bytes the engine actually holds:

- **Size** — multer's `limits.fileSize` is set to `MAX_IMAGE_BYTES`, so the
  request is cut off rather than buffered whole and then rejected.
- **Declared type** — the part's MIME type must be one of `image/jpeg`,
  `image/png`, `image/webp`, `image/gif`.
- **Actual type** — the file's leading bytes are read and must identify the same
  format. A declared content type is a claim by the uploader; the magic number
  is the file. This is what stops an HTML or SVG payload arriving labelled as a
  PNG and then being served from the media bucket.

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
`ensureQueues()`. Creates the bucket and applies a public-read bucket policy.
Writes `S3_BUCKET` to `.env.generated`. **No CORS rule** — the browser never
talks to S3 now, and an `<img>` load is not a CORS request.

**`apps/web`** — `lib/api/uploads.ts` posts the file to the engine, and an
`ImageUploader` component in the admin product form: file picker, per-file
progress, thumbnail preview, remove-before-submit, inline per-file errors.

Product images render with a plain `<img>` and explicit dimensions, not
`next/image`. The optimiser requires a `remotePatterns` allow-list that fails
confusingly for user-supplied hosts, and buys little for images whose dimensions
we already control.

### Failure handling

- **Wrong declared type, or bytes that do not match it** — 422 problem from the
  engine, shown against the file.
- **Oversize** — multer aborts the request at `MAX_IMAGE_BYTES`; the engine
  turns that into a 413 problem naming the limit.
- **Upload failure** — that file is marked failed and can be removed or retried;
  the rest of the form stays usable.
- **Orphaned objects** — a file uploaded before a product create that then fails
  stays in the bucket. Accepted deliberately: reaping them is real work
  (lifecycle rules, or a sweep correlating keys against products) for a
  development stack whose bucket is discarded on every `docker:down`.

## Testing

**Unit** — key construction and filename sanitisation, including attempts to
traverse out of the prefix; magic-number sniffing for each accepted format and
for a file whose declared type is a lie; the web client's error mapping.

**Integration, against LocalStack** — store a real file through the service,
then fetch the returned `objectUrl` with no credentials and get the bytes back.
The public-read path is the one thing that genuinely depends on S3's own
behaviour, so it is asserted against S3 rather than assumed.

Note what is deliberately *not* asserted against LocalStack: size and type
limits. Those are enforced by the engine now precisely because LocalStack cannot
be relied on to enforce anything, so they are tested where they live.

**End to end** — an admin creates a product with an uploaded image and the image
renders on the product detail page.

## Out of scope

- Changing the images on an existing product. Blocked on update routes.
- Image resizing, thumbnail generation, format conversion, and CDN delivery.
- Reaping orphaned objects.
- Uploads for any entity other than Product.
- Real AWS S3 deployment. The bucket lives in LocalStack; nothing here assumes
  otherwise beyond the endpoint being configurable.

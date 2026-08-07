# Product Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin upload product photographs from the browser straight to S3, so `ProductRecord.images` finally holds real URLs.

**Architecture:** The engine signs a presigned POST; the browser posts the file directly to S3, so the bytes never touch the API. The signed policy pins content type and size, which is what makes those limits real rather than advisory. Uploads happen before the product is created, because the engine has no update routes.

**Tech Stack:** LocalStack S3 · `@aws-sdk/client-s3` · `@aws-sdk/s3-presigned-post` · NestJS · Next.js + ANTD · Jest (engine, seed) · Vitest (web) · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-07-product-image-upload-design.md`

## Global Constraints

- **Presigning must use the host-facing endpoint** (`S3_PUBLIC_ENDPOINT`, `http://localhost:4566`), never the internal one. A presigned URL's signature is bound to its host: signing against `localstack:4566` yields a URL the browser rejects with an opaque 403, not a connection error. Same split, same reason, as `COGNITO_ENDPOINT` / `COGNITO_ENDPOINT_HOST` in `docker/seed/seed.ts`.
- `forcePathStyle: true` on every S3 client. LocalStack serves `http://localhost:4566/<bucket>/<key>`.
- Object keys are `<tenantId>/products/<uploadId>/<sanitised-filename>`, `uploadId` a fresh ULID — never the product id, which does not exist yet.
- Allowed content types are exactly `image/jpeg`, `image/png`, `image/webp`, `image/gif`. `MAX_IMAGE_BYTES` defaults to `5242880` (5 MB).
- The uploads module registers **only** when `S3_BUCKET` is set, following `DevTokenModule.registerIfEnabled` in `packages/openapi/src/dev-token/dev-token.module.ts`. An engine without it configured behaves exactly as it does today.
- **Adding any field to `EnvSchema` breaks `makeEnv` in `apps/engine/src/messaging/sqs-consumer.service.test.ts`** — it builds an `EnvConfig` object literal. This has bitten twice (commits `0451978`, `0eb65ae`). Update it in the same task.
- Any new engine `*.int-test.ts` copies the Redis teardown from `apps/engine/src/docs/openapi-document.int-test.ts` verbatim: wait for `ready`, `redis.quit()`, then `app.close()`.
- Images render with a plain `<img>` and explicit dimensions, never `next/image`.
- Commit after every task. No Claude co-author trailer.

---

### Task 1: S3 bucket in LocalStack, created by the seed

**Files:**
- Create: `docker/seed/s3.ts`
- Modify: `docker/seed/seed.ts`, `docker/seed/verify.test.ts`, `docker/seed/package.json`
- Modify: `docker/docker-compose.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `BUCKET_NAME` (the string `marketplace-media`) and `ensureBucket(): Promise<string>` from `docker/seed/s3.ts`; `S3_BUCKET` written into `docker/.env.generated`.

- [ ] **Step 1: Enable s3 in LocalStack**

```yaml
# docker/docker-compose.yml — the localstack service
  localstack:
    image: localstack/localstack:3.8
    environment:
      SERVICES: sqs,s3
      AWS_DEFAULT_REGION: us-east-1
    ports: ['4566:4566']
    healthcheck:
      # Both services, not just sqs: LocalStack answers for one before the
      # other, and an engine that starts against a half-ready LocalStack fails
      # its first presign with a confusing connection error.
      test:
        - CMD-SHELL
        - >-
          curl -s http://localhost:4566/_localstack/health > /tmp/h
          && grep -qE '"sqs": "(available|running)"' /tmp/h
          && grep -qE '"s3": "(available|running)"' /tmp/h
      interval: 3s
      retries: 30
```

- [ ] **Step 2: Write the failing test**

```ts
// docker/seed/verify.test.ts — add to the existing describe block.
// Add these imports at the top of the file alongside the others.
import { S3Client, GetBucketCorsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { BUCKET_NAME } from './s3';

it('creates the media bucket, publicly readable and CORS-enabled for the console', async () => {
  const s3 = new S3Client({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: creds,
    forcePathStyle: true,
  });

  await expect(s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))).resolves.toBeDefined();

  const cors = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET_NAME }));
  const rule = cors.CORSRules![0]!;
  // Without POST the browser's presigned upload is blocked before it starts.
  expect(rule.AllowedMethods).toEqual(expect.arrayContaining(['POST', 'GET']));
  expect(rule.AllowedOrigins).toContain('http://localhost:3002');

  expect(env.S3_BUCKET).toBe(BUCKET_NAME);
});

it('serves an uploaded object to an unauthenticated reader', async () => {
  const s3 = new S3Client({
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: creds,
    forcePathStyle: true,
  });
  const key = 'verify/public-read-probe.txt';
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: 'hello', ContentType: 'text/plain' }),
  );

  // A plain fetch with no credentials at all -- this is exactly how an <img>
  // tag will load a product photograph.
  const res = await fetch(`http://localhost:4566/${BUCKET_NAME}/${key}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('hello');
});
```

Add `PutObjectCommand` to the `@aws-sdk/client-s3` import.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm docker:down && pnpm docker:up && pnpm --filter @marketplace/seed test`
Expected: FAIL — `Cannot find module './s3'`.

- [ ] **Step 4: Add the dependency**

Add `"@aws-sdk/client-s3": "^3.665.0"` to `docker/seed/package.json` dependencies, then `pnpm install`.

- [ ] **Step 5: Write the bucket seeder**

```ts
// docker/seed/s3.ts
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';

export const BUCKET_NAME = 'marketplace-media';

/** The console's origin. The browser posts the file itself, so S3 -- not the
 *  engine -- is what must allow this origin. */
const CONSOLE_ORIGIN = 'http://localhost:3002';

export async function ensureBucket(): Promise<string> {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
  });

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`bucket ${BUCKET_NAME} already exists`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
  }

  // Public read on objects only. Product photographs exist to be displayed, and
  // signing a read URL per thumbnail would cost a round-trip per image and
  // defeat browser caching. `s3:GetObject` and nothing else: no listing, so the
  // bucket cannot be enumerated.
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: BUCKET_NAME,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadObjects',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
          },
        ],
      }),
    }),
  );

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['POST', 'GET', 'HEAD'],
            AllowedOrigins: [CONSOLE_ORIGIN],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag', 'Location'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );

  return BUCKET_NAME;
}
```

- [ ] **Step 6: Call it from the seed and publish the name**

```ts
// docker/seed/seed.ts
import { ensureBucket } from './s3';           // add to the existing imports

// ...inside main(), after ensureQueues():
  const bucket = await ensureBucket();

// ...and add to the `lines` array, before the trailing '':
    `S3_BUCKET=${bucket}`,
```

- [ ] **Step 7: Give the seed container the S3 endpoint**

The `seed` service in `docker-compose.yml` already receives `SQS_ENDPOINT`. Add `S3_ENDPOINT: http://localstack:4566` to its `environment` block.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm docker:down && pnpm docker:up && pnpm --filter @marketplace/seed test`
Expected: PASS, 6 tests. Confirm `docker/.env.generated` now contains `S3_BUCKET=marketplace-media`.

- [ ] **Step 9: Commit**

```bash
git add docker/seed docker/docker-compose.yml pnpm-lock.yaml
git commit -m "feat(seed): create a public-read media bucket in LocalStack"
```

---

### Task 2: The presign contract

**Files:**
- Create: `packages/contracts/src/upload.ts`, `packages/contracts/src/upload.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IMAGE_CONTENT_TYPES`, `ImageContentTypeSchema`, `PresignUploadSchema` / `PresignUpload` (`{ filename, contentType }`), `PresignedUploadSchema` / `PresignedUpload` (`{ url, fields, objectUrl }`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/upload.test.ts
import { PresignUploadSchema, PresignedUploadSchema, IMAGE_CONTENT_TYPES } from './upload';

describe('upload contracts', () => {
  it('accepts a supported image type', () => {
    expect(
      PresignUploadSchema.parse({ filename: 'chair.jpg', contentType: 'image/jpeg' }).contentType,
    ).toBe('image/jpeg');
  });

  it('rejects a content type outside the allow-list', () => {
    expect(
      PresignUploadSchema.safeParse({ filename: 'x.svg', contentType: 'image/svg+xml' }).success,
    ).toBe(false);
    expect(
      PresignUploadSchema.safeParse({ filename: 'x.pdf', contentType: 'application/pdf' }).success,
    ).toBe(false);
  });

  it('rejects an empty or oversized filename', () => {
    expect(PresignUploadSchema.safeParse({ filename: '', contentType: 'image/png' }).success).toBe(
      false,
    );
    expect(
      PresignUploadSchema.safeParse({ filename: 'a'.repeat(300), contentType: 'image/png' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      PresignUploadSchema.safeParse({
        filename: 'a.png',
        contentType: 'image/png',
        bucket: 'somewhere-else',
      }).success,
    ).toBe(false);
  });

  it('describes the presigned post the browser has to submit', () => {
    const parsed = PresignedUploadSchema.parse({
      url: 'http://localhost:4566/marketplace-media',
      fields: { key: 'acme/products/01J/x.png', 'Content-Type': 'image/png', Policy: 'abc' },
      objectUrl: 'http://localhost:4566/marketplace-media/acme/products/01J/x.png',
    });
    expect(parsed.fields.key).toContain('acme/products');
  });

  it('lists exactly the four supported types', () => {
    expect([...IMAGE_CONTENT_TYPES]).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/contracts test -- upload`
Expected: FAIL — `Cannot find module './upload'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/contracts/src/upload.ts
import { z } from 'zod';

/**
 * Deliberately excludes `image/svg+xml`. SVG is a document format that can
 * carry script, and these objects are served publicly from the same origin
 * pattern as everything else in the bucket.
 */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const ImageContentTypeSchema = z.enum(IMAGE_CONTENT_TYPES);
export type ImageContentType = z.infer<typeof ImageContentTypeSchema>;

export const PresignUploadSchema = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: ImageContentTypeSchema,
  })
  .strict();
export type PresignUpload = z.infer<typeof PresignUploadSchema>;

/**
 * `url` and `fields` are posted verbatim as multipart/form-data by the browser,
 * with the file appended last -- S3 requires the file to be the final field.
 * `objectUrl` is where the object will be readable once that succeeds, and is
 * what gets stored in `ProductRecord.images`.
 */
export const PresignedUploadSchema = z
  .object({
    url: z.string().url(),
    fields: z.record(z.string(), z.string()),
    objectUrl: z.string().url(),
  })
  .strict();
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;
```

```ts
// packages/contracts/src/index.ts — add alongside the existing exports
export * from './upload';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/contracts test -- upload`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): add the presigned upload request and response schemas"
```

---

### Task 3: The engine's uploads module

**Files:**
- Create: `apps/engine/src/uploads/object-key.ts`, `object-key.test.ts`, `uploads.service.ts`, `uploads.controller.ts`, `uploads.module.ts`
- Modify: `apps/engine/src/config/env.schema.ts`, `apps/engine/src/app.module.ts`, `apps/engine/src/messaging/sqs-consumer.service.test.ts`, `apps/engine/package.json`, `docker/docker-compose.yml`

**Interfaces:**
- Consumes: `PresignUpload`, `PresignedUpload`, `IMAGE_CONTENT_TYPES` (Task 2); `currentPrincipal()` from `../common/tenant-context`; `newId()` from `../common/ids`.
- Produces: `sanitiseFilename(name: string): string` and `buildObjectKey(tenantId: string, uploadId: string, filename: string): string` from `object-key.ts`; `UploadsService.presign(input: PresignUpload): Promise<PresignedUpload>`; `UploadsModule.registerIfEnabled(env)`; `POST /api/v1/uploads/product-image`.

- [ ] **Step 1: Write the failing test for the pure part**

```ts
// apps/engine/src/uploads/object-key.test.ts
import { sanitiseFilename, buildObjectKey } from './object-key';

describe('sanitiseFilename', () => {
  it('keeps a reasonable name intact', () => {
    expect(sanitiseFilename('desk-chair.jpg')).toBe('desk-chair.jpg');
  });

  // The filename arrives from the browser. Without this, a caller could write
  // outside its own tenant prefix, which is the one thing the key layout exists
  // to guarantee.
  it('strips path traversal and directory separators', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('a/b/c.png')).toBe('c.png');
    expect(sanitiseFilename('..\\..\\windows\\evil.png')).toBe('evil.png');
  });

  it('replaces characters that are awkward in a URL', () => {
    expect(sanitiseFilename('my photo (1)#2.png')).toBe('my-photo-1-2.png');
  });

  it('falls back to a generic name when nothing usable survives', () => {
    expect(sanitiseFilename('...')).toBe('upload');
    expect(sanitiseFilename('   ')).toBe('upload');
  });

  it('caps the length', () => {
    expect(sanitiseFilename(`${'a'.repeat(300)}.png`).length).toBeLessThanOrEqual(100);
  });
});

describe('buildObjectKey', () => {
  it('namespaces by tenant and upload', () => {
    expect(buildObjectKey('acme', '01J0000000000000000000000A', 'chair.png')).toBe(
      'acme/products/01J0000000000000000000000A/chair.png',
    );
  });

  it('cannot be escaped by a hostile filename', () => {
    const key = buildObjectKey('acme', '01J0000000000000000000000A', '../../globex/steal.png');
    expect(key.startsWith('acme/products/')).toBe(true);
    expect(key).not.toContain('..');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test -- object-key`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the key builder**

```ts
// apps/engine/src/uploads/object-key.ts

/**
 * The filename comes from the browser and ends up inside an S3 key, so it is
 * reduced to a bare basename with a conservative character set. Everything
 * before the last separator is discarded, which is what makes traversal
 * impossible rather than merely unlikely.
 */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : 'upload';
}

/** `<tenantId>/products/<uploadId>/<filename>` -- see the spec's key layout. */
export function buildObjectKey(tenantId: string, uploadId: string, filename: string): string {
  return `${tenantId}/products/${uploadId}/${sanitiseFilename(filename)}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @marketplace/engine test -- object-key`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the dependencies and the env fields**

Add to `apps/engine/package.json` dependencies:
`"@aws-sdk/client-s3": "^3.665.0"`, `"@aws-sdk/s3-presigned-post": "^3.665.0"`. Then `pnpm install`.

```ts
// apps/engine/src/config/env.schema.ts — add inside EnvSchema, after CORS_ORIGINS
  // Object storage for product images. The module registers only when
  // S3_BUCKET is set, so an engine without it behaves exactly as before.
  S3_BUCKET: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  // Host-facing, and the one presigning uses. A presigned URL's signature is
  // bound to its host: signing against the internal `localstack:4566` produces
  // a URL the browser rejects with an opaque 403. Same split as
  // COGNITO_ENDPOINT / COGNITO_ENDPOINT_HOST.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5_242_880),
```

Then add the matching entry to `makeEnv` in `apps/engine/src/messaging/sqs-consumer.service.test.ts`, which builds an `EnvConfig` literal and will not compile otherwise:

```ts
    CORS_ORIGINS: '',
    MAX_IMAGE_BYTES: 5_242_880,
```

`S3_BUCKET`, `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` are optional, so they need no entry.

- [ ] **Step 6: Write the service, controller and module**

```ts
// apps/engine/src/uploads/uploads.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { PresignUpload, PresignedUpload } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { buildObjectKey } from './object-key';

@Injectable()
export class UploadsService {
  private readonly client: S3Client;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.client = new S3Client({
      region: env.AWS_REGION,
      // The PUBLIC endpoint on purpose: this client exists to sign URLs the
      // browser will use, and the signature is bound to the host it was signed
      // for. Signing against S3_ENDPOINT would produce URLs that fail their
      // signature check from the browser.
      endpoint: env.S3_PUBLIC_ENDPOINT,
      forcePathStyle: true,
    });
  }

  async presign(input: PresignUpload): Promise<PresignedUpload> {
    const { tenantId } = currentPrincipal();
    const key = buildObjectKey(tenantId, newId(), input.filename);
    const bucket = this.env.S3_BUCKET!;

    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: bucket,
      Key: key,
      // The policy is the enforcement point. S3 rejects a body outside this
      // range or with a different content type -- neither limit depends on the
      // client telling the truth about the file it is sending.
      Conditions: [
        ['content-length-range', 0, this.env.MAX_IMAGE_BYTES],
        ['eq', '$Content-Type', input.contentType],
      ],
      Fields: { 'Content-Type': input.contentType },
      Expires: 300,
    });

    return { url, fields, objectUrl: `${this.env.S3_PUBLIC_ENDPOINT}/${bucket}/${key}` };
  }
}
```

```ts
// apps/engine/src/uploads/uploads.controller.ts
import { Controller, HttpCode, Post } from '@nestjs/common';
import { PresignUpload, PresignUploadSchema, PresignedUpload } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  // 200, not 201: signing creates no resource. The object does not exist until
  // the browser completes the upload this describes.
  @Post('product-image')
  @HttpCode(200)
  presign(@ZodBody(PresignUploadSchema) body: PresignUpload): Promise<PresignedUpload> {
    return this.uploads.presign(body);
  }
}
```

```ts
// apps/engine/src/uploads/uploads.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { EnvConfig } from '../config/env.schema';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({})
export class UploadsModule {
  /**
   * No controller and no providers unless object storage is configured, so a
   * deployment without a bucket 404s the route from the router rather than
   * exposing an endpoint that fails at call time. Same shape as
   * `DevTokenModule.registerIfEnabled`.
   */
  static registerIfEnabled(env: Pick<EnvConfig, 'S3_BUCKET' | 'S3_PUBLIC_ENDPOINT'>): DynamicModule {
    if (!env.S3_BUCKET || !env.S3_PUBLIC_ENDPOINT) return { module: UploadsModule };
    return {
      module: UploadsModule,
      controllers: [UploadsController],
      providers: [UploadsService],
    };
  }
}
```

Register it in `apps/engine/src/app.module.ts`. `ConfigModule` provides `ENV`, and `registerIfEnabled` needs only two values at metadata-evaluation time, so read them from `process.env` the way `DevTokenModule` does:

```ts
import { UploadsModule } from './uploads/uploads.module';

// in the imports array, after FlowsModule:
    UploadsModule.registerIfEnabled({
      S3_BUCKET: process.env.S3_BUCKET,
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
    }),
```

- [ ] **Step 7: Configure the engine container**

```yaml
# docker/docker-compose.yml — the engine service's `environment:` block
      S3_ENDPOINT: http://localstack:4566
      S3_PUBLIC_ENDPOINT: http://localhost:4566
```

`S3_BUCKET` arrives from `.env.generated`, written by the seed in Task 1.

- [ ] **Step 8: Verify the build and the existing suite**

Run: `pnpm --filter @marketplace/engine build && pnpm --filter @marketplace/engine test`
Expected: builds clean, every suite passes. If `sqs-consumer.service.test.ts` fails to compile, Step 5's `makeEnv` edit was missed.

- [ ] **Step 9: Commit**

```bash
git add apps/engine docker/docker-compose.yml pnpm-lock.yaml
git commit -m "feat(engine): sign presigned S3 posts for product images"
```

---

### Task 4: Prove the policy against real S3

The whole approach rests on one claim: **S3 itself rejects an oversized or wrong-typed upload.** Asserting that anywhere except against real S3 proves nothing.

**Files:**
- Create: `apps/engine/src/uploads/uploads.int-test.ts`

**Interfaces:**
- Consumes: `createApp` from `../app.factory`; `REDIS` from `../redis/redis.module`; `UploadsService`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
// apps/engine/src/uploads/uploads.int-test.ts
import { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';
// Re-exported from @marketplace/auth, which is what makes this the same
// AsyncLocalStorage the service's `currentPrincipal()` reads.
import { runWithTenant } from '../common/tenant-context';
import { UploadsService } from './uploads.service';
import type { PresignedUpload } from '@marketplace/contracts';

const BUCKET = 'marketplace-media';

/** Posts a body to S3 exactly as the browser will: the fields first, the file last. */
async function upload(presigned: PresignedUpload, body: Blob, contentType: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) form.append(k, v);
  form.append('Content-Type', contentType);
  form.append('file', body, 'probe.png');
  return fetch(presigned.url, { method: 'POST', body: form });
}

describe('presigned uploads (against LocalStack S3)', () => {
  let app: INestApplication;
  let uploads: UploadsService;

  beforeAll(async () => {
    process.env.SQS_CONSUMER_ENABLED = 'false';
    process.env.S3_BUCKET = BUCKET;
    process.env.S3_ENDPOINT ??= 'http://localhost:4566';
    process.env.S3_PUBLIC_ENDPOINT ??= 'http://localhost:4566';
    process.env.MAX_IMAGE_BYTES = '1024';
    process.env.QUEUE_URL ??=
      'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWKS_URI ??= 'http://localhost:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';

    app = await createApp();
    await app.init();
    uploads = app.get(UploadsService);
  });

  afterAll(async () => {
    // See openapi-document.int-test.ts: quitting before `ready` makes ioredis
    // schedule a 2000ms reconnect timer that outlives the suite.
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
    await redis.quit();
    await app.close();
    delete process.env.S3_BUCKET;
    delete process.env.MAX_IMAGE_BYTES;
  });

  const presignFor = (filename: string, contentType: 'image/png' | 'image/jpeg') =>
    runWithTenant({ tenantId: 'acme', userId: 'u1', role: 'admin' }, () =>
      uploads.presign({ filename, contentType }),
    );

  it('accepts a compliant upload and serves it publicly', async () => {
    const presigned = await presignFor('chair.png', 'image/png');
    expect(presigned.objectUrl).toContain('acme/products/');

    const res = await upload(presigned, new Blob([new Uint8Array(512)]), 'image/png');
    expect(res.status).toBeLessThan(400);

    // No credentials: this is how an <img> tag will load it.
    const read = await fetch(presigned.objectUrl);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
  });

  it('lets S3 reject a body over the policy limit', async () => {
    const presigned = await presignFor('huge.png', 'image/png');
    // MAX_IMAGE_BYTES is 1024 for this suite.
    const res = await upload(presigned, new Blob([new Uint8Array(4096)]), 'image/png');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toContain('EntityTooLarge');
  });

  it('lets S3 reject a content type the policy did not sign', async () => {
    const presigned = await presignFor('sneaky.png', 'image/png');
    const res = await upload(presigned, new Blob([new Uint8Array(64)]), 'image/jpeg');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('keys uploads under the calling tenant', async () => {
    const globex = await runWithTenant({ tenantId: 'globex', userId: 'g', role: 'admin' }, () =>
      uploads.presign({ filename: 'x.png', contentType: 'image/png' }),
    );
    expect(globex.fields.key).toMatch(/^globex\/products\//);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test -- uploads`
Expected: PASS, 4 tests, with no "worker process has failed to exit gracefully".

If the oversize case returns a *success*, the `content-length-range` condition is not reaching the policy — the whole approach is unsound and must be fixed before proceeding, not worked around in the client.

- [ ] **Step 3: Commit**

```bash
git add apps/engine/src/uploads
git commit -m "test(engine): prove S3 enforces the presigned policy's size and type limits"
```

---

### Task 5: Uploading from the console

**Files:**
- Create: `apps/web/lib/api/uploads.ts`, `apps/web/lib/api/uploads.test.ts`, `apps/web/components/image-uploader.tsx`, `apps/web/components/image-uploader.test.tsx`
- Modify: `apps/web/app/admin/products/new/page.tsx`, `apps/web/app/products/[id]/page.tsx`, `apps/web/app/products/page.tsx`

**Interfaces:**
- Consumes: `request` (`lib/api/http.ts`), `PresignedUploadSchema`, `IMAGE_CONTENT_TYPES`.
- Produces: `presignProductImage(filename, contentType): Promise<PresignedUpload>`, `uploadToS3(presigned, file): Promise<string>` (resolves to the object URL), and `<ImageUploader value={string[]} onChange={(urls) => void} />`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/api/uploads.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { uploadToS3, S3UploadError } from './uploads';

const presigned = {
  url: 'http://localhost:4566/marketplace-media',
  fields: { key: 'acme/products/01J/x.png', Policy: 'abc' },
  objectUrl: 'http://localhost:4566/marketplace-media/acme/products/01J/x.png',
};

const file = new File([new Uint8Array(8)], 'x.png', { type: 'image/png' });

describe('uploadToS3', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts the signed fields with the file last and returns the object URL', async () => {
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('', { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadToS3(presigned, file)).resolves.toBe(presigned.objectUrl);

    const body = fetchMock.mock.calls[0]![1]!.body as FormData;
    const keys = [...body.keys()];
    expect(keys).toContain('key');
    // S3 ignores every field after the file, so the file must be last.
    expect(keys[keys.length - 1]).toBe('file');
  });

  it('turns an S3 size rejection into a readable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<?xml version="1.0"?><Error><Code>EntityTooLarge</Code><Message>Your proposed upload exceeds the maximum allowed size</Message></Error>',
            { status: 400 },
          ),
      ),
    );

    const err = (await uploadToS3(presigned, file).catch((e: unknown) => e)) as S3UploadError;
    expect(err).toBeInstanceOf(S3UploadError);
    // Not raw XML in the user's face.
    expect(err.message).toMatch(/too large/i);
    expect(err.message).not.toContain('<?xml');
  });

  it('reports an unrecognised S3 failure without leaking the XML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })),
    );
    const err = (await uploadToS3(presigned, file).catch((e: unknown) => e)) as S3UploadError;
    expect(err.code).toBe('AccessDenied');
    expect(err.message).not.toContain('<Error>');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/web test -- uploads`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the client**

```ts
// apps/web/lib/api/uploads.ts
import {
  PresignedUploadSchema,
  type ImageContentType,
  type PresignedUpload,
} from '@marketplace/contracts';
import { request } from './http';

export class S3UploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'S3UploadError';
  }
}

export const presignProductImage = (filename: string, contentType: ImageContentType) =>
  request('/uploads/product-image', {
    method: 'POST',
    body: { filename, contentType },
    schema: PresignedUploadSchema,
  });

const MESSAGES: Record<string, string> = {
  EntityTooLarge: 'That image is too large.',
  AccessDenied: 'The upload was refused. The signed link may have expired — try again.',
  ExpiredToken: 'The upload link expired. Try again.',
};

/** S3 answers with an XML error body, which no user should ever be shown. */
function describeFailure(xml: string): S3UploadError {
  const code = /<Code>([^<]+)<\/Code>/.exec(xml)?.[1] ?? 'UploadFailed';
  return new S3UploadError(code, MESSAGES[code] ?? 'The upload failed. Try again.');
}

export async function uploadToS3(presigned: PresignedUpload, file: File): Promise<string> {
  const form = new FormData();
  for (const [key, value] of Object.entries(presigned.fields)) form.append(key, value);
  // Last, always: S3 ignores every form field that appears after the file.
  form.append('file', file);

  const res = await fetch(presigned.url, { method: 'POST', body: form });
  if (!res.ok) throw describeFailure(await res.text().catch(() => ''));
  return presigned.objectUrl;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @marketplace/web test -- uploads`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the uploader component test**

```tsx
// apps/web/components/image-uploader.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ImageUploader } from './image-uploader';
import * as api from '../lib/api/uploads';

const presigned = {
  url: 'http://localhost:4566/marketplace-media',
  fields: { key: 'acme/products/01J/x.png' },
  objectUrl: 'http://localhost:4566/marketplace-media/acme/products/01J/x.png',
};

const pngFile = () => new File([new Uint8Array(8)], 'chair.png', { type: 'image/png' });

describe('ImageUploader', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uploads a chosen file and reports the object URL', async () => {
    vi.spyOn(api, 'presignProductImage').mockResolvedValue(presigned);
    vi.spyOn(api, 'uploadToS3').mockResolvedValue(presigned.objectUrl);
    const onChange = vi.fn();

    render(<ImageUploader value={[]} onChange={onChange} />);
    const input = screen.getByTestId('image-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [pngFile()] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith([presigned.objectUrl]);
  });

  it('rejects an unsupported type without calling the API', async () => {
    const presign = vi.spyOn(api, 'presignProductImage');
    render(<ImageUploader value={[]} onChange={vi.fn()} />);
    const input = screen.getByTestId('image-input') as HTMLInputElement;

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [new File([new Uint8Array(4)], 'doc.pdf', { type: 'application/pdf' })],
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(presign).not.toHaveBeenCalled();
    expect(screen.getByText(/not a supported image/i)).toBeInTheDocument();
  });

  it('shows a readable message when the upload is refused', async () => {
    vi.spyOn(api, 'presignProductImage').mockResolvedValue(presigned);
    vi.spyOn(api, 'uploadToS3').mockRejectedValue(
      new api.S3UploadError('EntityTooLarge', 'That image is too large.'),
    );

    render(<ImageUploader value={[]} onChange={vi.fn()} />);
    const input = screen.getByTestId('image-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [pngFile()] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(screen.getByText('That image is too large.')).toBeInTheDocument();
  });

  it('removes an already-uploaded image', async () => {
    const onChange = vi.fn();
    render(<ImageUploader value={[presigned.objectUrl]} onChange={onChange} />);
    await act(async () => {
      screen.getByRole('button', { name: /remove/i }).click();
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails, then write the component**

Run: `pnpm --filter @marketplace/web test -- image-uploader` → FAIL, module not found.

```tsx
// apps/web/components/image-uploader.tsx
'use client';

import { useRef, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import { IMAGE_CONTENT_TYPES, type ImageContentType } from '@marketplace/contracts';
import { presignProductImage, uploadToS3 } from '../lib/api/uploads';

interface Props {
  value: string[];
  onChange: (urls: string[]) => void;
}

const isSupported = (type: string): type is ImageContentType =>
  (IMAGE_CONTENT_TYPES as readonly string[]).includes(type);

export function ImageUploader({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (files: FileList) => {
    setError(null);
    const uploaded: string[] = [];

    for (const file of Array.from(files)) {
      // Checked here as well as in the policy: refusing locally is instant and
      // costs no round-trip, while the policy is what actually enforces it.
      if (!isSupported(file.type)) {
        setError(`${file.name} is not a supported image (JPEG, PNG, WebP or GIF).`);
        continue;
      }
      try {
        const presigned = await presignProductImage(file.name, file.type);
        uploaded.push(await uploadToS3(presigned, file));
      } catch (err) {
        setError((err as Error).message);
      }
    }

    if (uploaded.length) onChange([...value, ...uploaded]);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <input
        ref={inputRef}
        data-testid="image-input"
        type="file"
        multiple
        accept={IMAGE_CONTENT_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files;
          if (!files?.length) return;
          setBusy(true);
          void handle(files).finally(() => {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = '';
          });
        }}
      />
      <Space>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          Add images
        </Button>
        {busy && <Spin size="small" />}
      </Space>

      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} />}

      <Space wrap>
        {value.map((url) => (
          <Space key={url} direction="vertical" align="center">
            {/* Plain img, not next/image: the optimiser needs a remotePatterns
                allow-list that fails confusingly for user-supplied hosts. */}
            <img
              src={url}
              alt=""
              width={96}
              height={96}
              style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #eee' }}
            />
            <Button size="small" onClick={() => onChange(value.filter((u) => u !== url))}>
              Remove
            </Button>
          </Space>
        ))}
      </Space>
    </Space>
  );
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `pnpm --filter @marketplace/web test -- image-uploader`
Expected: PASS, 4 tests.

- [ ] **Step 8: Wire it into the product form**

In `apps/web/app/admin/products/new/page.tsx`, hold the uploaded URLs in state and submit them instead of the hard-coded `images: []`:

```tsx
  const [images, setImages] = useState<string[]>([]);
  // ...in submit(), replace `images: [],` with:
        images,
  // ...and add above the generated attribute fields:
        <Form.Item label="Images">
          <ImageUploader value={images} onChange={setImages} />
        </Form.Item>
```

Import `useState` from `react` and `ImageUploader` from `../../../../components/image-uploader`.

- [ ] **Step 9: Render images where products are shown**

On the product detail page (`app/products/[id]/page.tsx`), add a row of thumbnails above the `Descriptions` when `product.images.length > 0`:

```tsx
      {product.images.length > 0 && (
        <Space wrap style={{ marginBottom: 16 }}>
          {product.images.map((url) => (
            <img
              key={url}
              src={url}
              alt={product.name}
              width={160}
              height={160}
              style={{ objectFit: 'cover', borderRadius: 8 }}
            />
          ))}
        </Space>
      )}
```

On the products list (`app/products/page.tsx`), add a leading column rendering the first image at 40×40, or nothing when the array is empty:

```tsx
      {
        title: '',
        dataIndex: 'images',
        width: 56,
        render: (images: string[]) =>
          images[0] ? (
            <img
              src={images[0]}
              alt=""
              width={40}
              height={40}
              style={{ objectFit: 'cover', borderRadius: 4 }}
            />
          ) : null,
      },
```

- [ ] **Step 10: Verify the whole path by hand**

Run: `pnpm docker:down && pnpm docker:up`, sign in as `acme-admin`, go to `/admin/products/new`, add an image, create the product.
Expected: the thumbnail appears in the form before submit, the product detail page shows it, and the list shows it. Open the image URL in a private window with no session — it loads, confirming public read.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): upload product images straight to S3 from the admin form"
```

---

### Task 6: End-to-end coverage

**Files:**
- Create: `apps/web/test/e2e/image-upload.spec.ts`
- Modify: `apps/web/test/e2e/helpers/session.ts`, `README.md`

**Interfaces:**
- Consumes: `signIn`, `unique` from `./helpers/session`.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

```ts
// apps/web/test/e2e/image-upload.spec.ts
import { expect, test } from '@playwright/test';
import { signIn, unique } from './helpers/session';

// A one-pixel PNG, inline so the test needs no fixture file on disk.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('an admin uploads an image and it renders on the product', async ({ page }) => {
  const name = unique('photographed-widget');

  await signIn(page, 'acme-admin');
  await page.goto('/admin/products/new');

  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('has a photograph');
  await page.getByLabel('Category').fill('tools');
  await page.getByLabel('Price (minor units)').fill('1500');
  await page.getByLabel('Stock').fill('3');

  await page.getByTestId('image-input').setInputFiles({
    name: 'probe.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  // The thumbnail only appears once S3 has accepted the upload.
  const thumb = page.locator('img[src*="marketplace-media"]');
  await expect(thumb.first()).toBeVisible();

  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]{26}/);

  const detailImage = page.locator('img[src*="marketplace-media"]').first();
  await expect(detailImage).toBeVisible();

  // The stored URL must be publicly readable -- that is the whole reason the
  // bucket policy exists, and an <img> that 403s still "renders" in the DOM.
  const src = await detailImage.getAttribute('src');
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm docker:up && pnpm --filter @marketplace/web exec playwright test image-upload`
Expected: PASS.

- [ ] **Step 3: Run the whole thing from clean**

Run: `pnpm docker:down && pnpm e2e`
Expected: exit 0 across engine, agents and web suites.

- [ ] **Step 4: Document it**

In `README.md`, note under the console section that an admin can attach images when creating a product, that they are stored in the LocalStack `marketplace-media` bucket, and that objects are public-read by design. Add `s3` to the LocalStack description in the `docker:up` service list.

- [ ] **Step 5: Commit**

```bash
git add apps/web README.md
git commit -m "test(web): end-to-end product image upload"
```

---

## Verification

```bash
pnpm docker:down
pnpm install
pnpm build
pnpm e2e
```

Expected: every unit and integration suite passes, all three e2e suites pass, exit 0, no "worker process has failed to exit gracefully", and `marketplace_ollama-models` still present.

Then by hand, with the stack up: sign in as `acme-admin`, create a product with two images, confirm both render on the detail page and the first appears in the list. Open one image URL in a private window — it must load with no session, which is what the storefront redesign will depend on.

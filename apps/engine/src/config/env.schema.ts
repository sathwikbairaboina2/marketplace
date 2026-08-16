import { z } from 'zod';

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  AWS_REGION: z.string().default('us-east-1'),
  TABLE_NAME: z.string().default('MarketplaceEngine'),
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  SQS_ENDPOINT: z.string().url().optional(),
  QUEUE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWKS_URI: z.string().url(),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SQS_CONSUMER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DOCS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Comma-separated allowed origins for the browser client. Empty means CORS
  // stays off entirely, so a deployed build behaves exactly as it did before
  // this existed -- the same posture as DOCS_ENABLED.
  CORS_ORIGINS: z.string().default(''),
  // Requests per window per caller, and the window. Defaults are generous
  // because this protects the service from a runaway client rather than
  // policing normal use: the console's own first paint is a handful of calls,
  // and the end-to-end suites burst harder than any person does.
  RATE_LIMIT: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // Object storage for product images. The uploads module registers only when
  // S3_BUCKET is set, so an engine without object storage configured behaves
  // exactly as it did before this existed.
  S3_BUCKET: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  // Host-facing, and the one presigning uses. A presigned URL's signature is
  // bound to the host it was signed for: signing against the internal
  // `localstack:4566` yields a URL the browser rejects with an opaque 403
  // rather than a connection error. Same split, same reason, as
  // COGNITO_ENDPOINT / COGNITO_ENDPOINT_HOST in docker/seed/seed.ts.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5_242_880),
  DEV_TENANT_ID: z.string().min(1).default('tenant-dev'),
  DEV_USERNAME: z.string().min(1).default('dev@marketplace.local'),
  COGNITO_ENDPOINT: z.string().url().optional(),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');

// `DevTokenModule.registerIfEnabled` decides whether a controller exists at
// all, so it has to run while `@Module`'s metadata is being evaluated -- at
// import time, long before `ConfigModule` instantiates `ENV`. Parsing the full
// `EnvSchema` there would throw on any process that imports `AppModule`
// without the service's required runtime configuration (QUEUE_URL, REDIS_URL,
// JWKS_URI...), which is exactly what a unit or integration test does before
// its own `beforeAll` sets those. Every field this narrow schema picks is
// optional or defaulted, so it parses cleanly against any environment while
// still reading the same values from the same declarations.
export const DevTokenEnvSchema = EnvSchema.pick({
  DOCS_ENABLED: true,
  DEV_TENANT_ID: true,
  DEV_USERNAME: true,
  AWS_REGION: true,
  COGNITO_ENDPOINT: true,
  COGNITO_USER_POOL_ID: true,
  COGNITO_CLIENT_ID: true,
});

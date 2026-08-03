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
  DEV_TENANT_ID: z.string().min(1).default('tenant-dev'),
  DEV_USERNAME: z.string().min(1).default('dev@marketplace.local'),
  COGNITO_ENDPOINT: z.string().url().optional(),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');

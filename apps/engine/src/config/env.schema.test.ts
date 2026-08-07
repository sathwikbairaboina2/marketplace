import { EnvSchema } from './env.schema';

const REQUIRED_ENV = {
  QUEUE_URL: 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo',
  REDIS_URL: 'redis://localhost:6379',
  JWKS_URI: 'http://localhost:9229/pool/.well-known/jwks.json',
  JWT_ISSUER: 'http://localhost:9229/pool',
  JWT_AUDIENCE: 'client-id',
};

describe('EnvSchema docs configuration', () => {
  it('defaults DOCS_ENABLED to false', () => {
    expect(EnvSchema.parse(REQUIRED_ENV).DOCS_ENABLED).toBe(false);
  });

  it('parses DOCS_ENABLED="true" to the boolean true', () => {
    expect(EnvSchema.parse({ ...REQUIRED_ENV, DOCS_ENABLED: 'true' }).DOCS_ENABLED).toBe(true);
  });

  it('defaults DEV_TENANT_ID and DEV_USERNAME', () => {
    const env = EnvSchema.parse(REQUIRED_ENV);
    expect(env.DEV_TENANT_ID).toBe('tenant-dev');
    expect(env.DEV_USERNAME).toBe('dev@marketplace.local');
  });

  it('leaves the Cognito admin variables optional', () => {
    const env = EnvSchema.parse(REQUIRED_ENV);
    expect(env.COGNITO_ENDPOINT).toBeUndefined();
    expect(env.COGNITO_USER_POOL_ID).toBeUndefined();
    expect(env.COGNITO_CLIENT_ID).toBeUndefined();
  });

  it('accepts explicit Cognito admin variables', () => {
    const env = EnvSchema.parse({
      ...REQUIRED_ENV,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
      COGNITO_USER_POOL_ID: 'pool-1',
      COGNITO_CLIENT_ID: 'client-1',
    });
    expect(env.COGNITO_ENDPOINT).toBe('http://cognito-local:9229');
    expect(env.COGNITO_USER_POOL_ID).toBe('pool-1');
    expect(env.COGNITO_CLIENT_ID).toBe('client-1');
  });
});

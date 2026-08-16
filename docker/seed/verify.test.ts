import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_USERS, DEMO_PASSWORD } from './cognito';
import { loadCatalogue } from './catalogue';
import { BUCKET_NAME } from './s3';

const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.generated'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const creds = { accessKeyId: 'local', secretAccessKey: 'local' };

describe('seeded infrastructure', () => {
  it('creates the MarketplaceEngine table with GSI1', async () => {
    const ddb = new DynamoDBClient({ region: 'us-east-1', endpoint: 'http://localhost:8000', credentials: creds });
    const out = await ddb.send(new DescribeTableCommand({ TableName: 'MarketplaceEngine' }));
    expect(out.Table?.TableStatus).toBe('ACTIVE');
    expect(out.Table?.GlobalSecondaryIndexes?.[0]?.IndexName).toBe('GSI1');
  });

  it('creates the FIFO queue with a redrive policy', async () => {
    const sqs = new SQSClient({ region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: creds });
    const out = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: env.QUEUE_URL, AttributeNames: ['FifoQueue', 'RedrivePolicy'] }),
    );
    expect(out.Attributes?.FifoQueue).toBe('true');
    expect(out.Attributes?.RedrivePolicy).toContain('maxReceiveCount');
  });

  it('creates a Cognito user pool reachable over JWKS', async () => {
    const res = await fetch(env.JWKS_URI.replace('cognito-local', 'localhost'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[] };
    expect(body.keys.length).toBeGreaterThan(0);
  });

  // The browser console signs in as these users with a real USER_PASSWORD_AUTH
  // flow, and both the tenant and the role it renders come from the ID token's
  // claims -- so seeding them wrong is indistinguishable from a broken login.
  it('can authenticate every demo user, and each token carries its tenant and role', async () => {
    const cognito = new CognitoIdentityProviderClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:9229',
      credentials: creds,
    });

    for (const user of DEMO_USERS) {
      const out = await cognito.send(
        new InitiateAuthCommand({
          ClientId: env.COGNITO_CLIENT_ID,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: user.username, PASSWORD: DEMO_PASSWORD },
        }),
      );

      const idToken = out.AuthenticationResult?.IdToken;
      expect(idToken).toBeDefined();

      const claims = JSON.parse(
        Buffer.from(idToken!.split('.')[1], 'base64').toString('utf8'),
      ) as Record<string, string>;
      expect(claims['custom:tenant_id']).toBe(user.tenantId);
      expect(claims['custom:role']).toBe(user.role);
    }
  });

  const s3 = () =>
    new S3Client({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: creds,
      forcePathStyle: true,
    });

  it('creates the media bucket and publishes its name', async () => {
    await expect(s3().send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))).resolves.toBeDefined();
    expect(env.S3_BUCKET).toBe(BUCKET_NAME);
  });

  it('serves an uploaded object to an unauthenticated reader', async () => {
    const key = 'verify/public-read-probe.txt';
    await s3().send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: 'hello',
        ContentType: 'text/plain',
      }),
    );

    // A plain fetch carrying no credentials at all -- exactly how an <img> tag
    // will load a product photograph.
    const res = await fetch(`http://localhost:4566/${BUCKET_NAME}/${key}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
  });

  it('gives every demo tenant a catalogue', async () => {
    const byTenant = new Map<string, number>();
    for (const record of loadCatalogue()) {
      if (record.entityType !== 'Product') continue;
      const tenant = record.PK.replace('TENANT#', '');
      byTenant.set(tenant, (byTenant.get(tenant) ?? 0) + 1);
    }

    for (const user of DEMO_USERS) {
      expect(byTenant.get(user.tenantId) ?? 0).toBeGreaterThan(0);
    }
  });

  /**
   * The failure this guards against is silent and looks like a product bug: the
   * pool is rebuilt on every `docker:up`, so a `sub` captured yesterday is dead
   * today. Orders written against a dead `sub` still exist -- they just belong
   * to nobody, and the buyer signs in to an empty order list beside a catalogue
   * that obviously sold. Reading the orders back through the API as the buyer
   * is the only check that proves the substitution ran.
   */
  it('shows each seeded order to the buyer who placed it', async () => {
    const cognito = new CognitoIdentityProviderClient({
      region: 'us-east-1',
      endpoint: 'http://localhost:9229',
      credentials: creds,
    });

    const tenantsWithOrders = new Set(
      loadCatalogue()
        .filter((r) => r.entityType === 'Order')
        .map((r) => r.PK.replace('TENANT#', '')),
    );
    expect(tenantsWithOrders.size).toBeGreaterThan(0);

    for (const tenant of tenantsWithOrders) {
      const buyer = DEMO_USERS.find((u) => u.tenantId === tenant && u.role === 'buyer');
      expect(buyer).toBeDefined();

      const auth = await cognito.send(
        new InitiateAuthCommand({
          ClientId: env.COGNITO_CLIENT_ID,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: buyer!.username, PASSWORD: DEMO_PASSWORD },
        }),
      );

      const res = await fetch('http://localhost:3000/api/v1/orders?limit=50', {
        headers: { Authorization: `Bearer ${auth.AuthenticationResult!.IdToken}` },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: unknown[] };
      expect(body.items.length).toBeGreaterThan(0);
    }
  });
});

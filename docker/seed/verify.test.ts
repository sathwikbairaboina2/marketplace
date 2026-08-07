import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEMO_USERS, DEMO_PASSWORD } from './cognito';

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
});

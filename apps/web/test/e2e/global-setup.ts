import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Every run gets its own pair of tenants (#19): these specs create products,
 * orders and announcements, and pointing them at the seeded demo shop meant
 * every run left its litter in the shop a person opens first. The spec files
 * keep saying 'acme-admin' / 'globex-admin'; helpers/session.ts remaps those
 * personas to this run's users via the fixture written here.
 */
// __dirname, not import.meta: Playwright transpiles this file as CommonJS.
const ENV_FILE = path.resolve(__dirname, '../../../../docker/.env.generated');
const OUT_DIR = path.resolve(__dirname, '../../test-results');
const OUT = path.join(OUT_DIR, 'pw-users.json');
const ENGINE = 'http://127.0.0.1:3000/api/v1';
const PASSWORD = 'Passw0rd!';

export default async function globalSetup(): Promise<void> {
  const env = Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );

  const cognito = new CognitoIdentityProviderClient({
    region: 'us-east-1',
    // localhost resolves to ::1 first and Docker's IPv6 proxy naps; the
    // IPv4 literal always answers. Same trap, same fix as every harness here.
    endpoint: (env.COGNITO_ENDPOINT_HOST ?? '').replace('localhost', '127.0.0.1'),
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  const run = Date.now().toString(36);
  const tenantA = `pw-${run}-a`;
  const tenantB = `pw-${run}-b`;

  async function mint(tenantId: string, username: string, role: string): Promise<string> {
    const attrs = [
      { Name: 'custom:tenant_id', Value: tenantId },
      { Name: 'custom:role', Value: role },
    ];
    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: username,
          MessageAction: 'SUPPRESS',
          UserAttributes: attrs,
        }),
      );
    } catch (err) {
      if ((err as Error).name !== 'UsernameExistsException') throw err;
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: env.COGNITO_USER_POOL_ID,
          Username: username,
          UserAttributes: attrs,
        }),
      );
    }
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: env.COGNITO_USER_POOL_ID,
        Username: username,
        Password: PASSWORD,
        Permanent: true,
      }),
    );
    const auth = await cognito.send(
      new InitiateAuthCommand({
        ClientId: env.COGNITO_CLIENT_ID,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: username, PASSWORD },
      }),
    );
    return auth.AuthenticationResult!.IdToken!;
  }

  const adminA = `pw-${run}-a-admin`;
  const buyerA = `pw-${run}-a-buyer`;
  const adminB = `pw-${run}-b-admin`;

  const tokenA = await mint(tenantA, adminA, 'admin');
  await mint(tenantA, buyerA, 'buyer');
  const tokenB = await mint(tenantB, adminB, 'admin');

  // A fresh tenant greets its admin with the onboarding wizard; these specs
  // are not about onboarding, so both tenants skip it exactly as a real
  // owner can. The wizard has its own coverage in the journeys.
  for (const token of [tokenA, tokenB]) {
    await fetch(`${ENGINE}/storefront/onboarding`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    });
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ 'acme-admin': adminA, 'acme-buyer': buyerA, 'globex-admin': adminB }),
  );
}

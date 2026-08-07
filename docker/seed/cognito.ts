import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const POOL_NAME = 'marketplace';
const CLIENT_NAME = 'marketplace-engine';

/**
 * Two tenants on purpose. `globex-admin` exists so tenant isolation is
 * something a person can see by switching personas in the web console, not
 * only something an e2e assertion claims.
 */
export const DEMO_USERS = [
  { username: 'acme-admin', tenantId: 'acme', role: 'admin' },
  { username: 'acme-buyer', tenantId: 'acme', role: 'buyer' },
  { username: 'globex-admin', tenantId: 'globex', role: 'admin' },
] as const;

/** Matches apps/engine/test/e2e/helpers/auth.ts so there is one dev password. */
export const DEMO_PASSWORD = 'Passw0rd!';

export async function ensureUserPool(): Promise<{ userPoolId: string; clientId: string }> {
  const cognito = new CognitoIdentityProviderClient({ endpoint: process.env.COGNITO_ENDPOINT });

  const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  let userPoolId = pools.UserPools?.find((p) => p.Name === POOL_NAME)?.Id;

  if (!userPoolId) {
    const created = await cognito.send(
      new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        // A pool's schema is immutable once created. That costs nothing here
        // because scripts/docker-teardown.mjs removes the `cognito-data`
        // volume on every `docker:down`, so the next `docker:up` builds the
        // pool from this declaration rather than reusing a stale one.
        Schema: [
          { Name: 'tenant_id', AttributeDataType: 'String', Mutable: true },
          { Name: 'role', AttributeDataType: 'String', Mutable: true },
        ],
      }),
    );
    userPoolId = created.UserPool!.Id!;
  }

  const clients = await cognito.send(
    new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 }),
  );
  let clientId = clients.UserPoolClients?.find((c) => c.ClientName === CLIENT_NAME)?.ClientId;

  if (!clientId) {
    const created = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: CLIENT_NAME,
        ExplicitAuthFlows: ['ADMIN_NO_SRP_AUTH', 'USER_PASSWORD_AUTH'],
      }),
    );
    clientId = created.UserPoolClient!.ClientId!;
  }

  return { userPoolId, clientId };
}

export async function ensureDemoUsers(userPoolId: string): Promise<void> {
  const cognito = new CognitoIdentityProviderClient({ endpoint: process.env.COGNITO_ENDPOINT });

  for (const user of DEMO_USERS) {
    const attributes = [
      { Name: 'custom:tenant_id', Value: user.tenantId },
      { Name: 'custom:role', Value: user.role },
    ];

    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          MessageAction: 'SUPPRESS',
          UserAttributes: attributes,
        }),
      );
    } catch (err) {
      if ((err as Error).name !== 'UsernameExistsException') throw err;

      // Force the attributes rather than trusting whatever survived from an
      // earlier run: a user left carrying the wrong tenant would hand out a
      // token for the wrong tenant with no error at all, which is exactly what
      // the isolation demo must not be able to fake.
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          UserAttributes: attributes,
        }),
      );
    }

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: user.username,
        Password: DEMO_PASSWORD,
        Permanent: true,
      }),
    );
  }
}

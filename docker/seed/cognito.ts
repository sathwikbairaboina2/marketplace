import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  type ListUsersCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';

const POOL_NAME = 'marketplace';
const CLIENT_NAME = 'marketplace-engine';

/**
 * Four tenants on purpose, each with a seller and a buyer.
 *
 * `globex-admin` is the original reason this list exists: tenant isolation has
 * to be something a person can *see* by switching personas in the web console,
 * not only something an e2e assertion claims. The buyer half of each pair
 * matters for the same reason -- an order is only visible to the user whose
 * `sub` placed it, so a tenant with no buyer has no visible sales.
 *
 * The catalogue fixture keys its orders and bookings off these usernames, so
 * adding or renaming an entry here means updating
 * `fixtures/catalogue.json` to match.
 */
export const DEMO_USERS = [
  { username: 'acme-admin', tenantId: 'acme', role: 'admin' },
  { username: 'acme-buyer', tenantId: 'acme', role: 'buyer' },
  { username: 'globex-admin', tenantId: 'globex', role: 'admin' },
  { username: 'globex-buyer', tenantId: 'globex', role: 'buyer' },
  { username: 'nimbus-admin', tenantId: 'nimbus', role: 'admin' },
  { username: 'nimbus-buyer', tenantId: 'nimbus', role: 'buyer' },
  { username: 'verde-admin', tenantId: 'verde', role: 'admin' },
  { username: 'verde-buyer', tenantId: 'verde', role: 'buyer' },
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

/**
 * Username -> Cognito `sub`, for every demo user.
 *
 * The pool is rebuilt from scratch on every `docker:up` (the compose teardown
 * drops the cognito-data volume), so a `sub` is only stable within one run of
 * the stack. Seeded orders and bookings are keyed on the buyer's `sub` -- the
 * engine's GSI1 partition is `TENANT#<t>#USER#<sub>` -- so the catalogue seed
 * has to learn today's values rather than hard-code yesterday's, or a buyer
 * would sign in to an empty order list beside a catalogue that clearly sold.
 */
export async function ensureDemoUsers(userPoolId: string): Promise<Record<string, string>> {
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

  return collectSubs(cognito, userPoolId);
}

/**
 * `AdminCreateUser` returns the sub for a user it just created, but not for one
 * that already existed, and this seed is idempotent by design. Listing the pool
 * afterwards is the one path that answers for both cases.
 */
async function collectSubs(
  cognito: CognitoIdentityProviderClient,
  userPoolId: string,
): Promise<Record<string, string>> {
  const wanted = new Set<string>(DEMO_USERS.map((u) => u.username));
  const subs: Record<string, string> = {};
  let paginationToken: string | undefined;

  do {
    const page: ListUsersCommandOutput = await cognito.send(
      new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken: paginationToken }),
    );
    for (const user of page.Users ?? []) {
      if (!user.Username || !wanted.has(user.Username)) continue;
      const sub = user.Attributes?.find((a) => a.Name === 'sub')?.Value;
      if (sub) subs[user.Username] = sub;
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);

  const missing = [...wanted].filter((u) => !(u in subs));
  if (missing.length > 0) {
    throw new Error(`cognito returned no sub for: ${missing.join(', ')}`);
  }

  return subs;
}

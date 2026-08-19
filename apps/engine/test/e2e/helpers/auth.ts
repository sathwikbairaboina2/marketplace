import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import '../setup';

const PASSWORD = 'Passw0rd!';

const client = new CognitoIdentityProviderClient({
  region: 'us-east-1',
  // `localhost` resolves to ::1 before 127.0.0.1 on some hosts, and Docker
  // Desktop's IPv6 loopback proxy is not reliably listening -- a state that
  // fails every suite here at once, for reasons that have nothing to do with
  // the code. The seed still writes `localhost` into JWT_ISSUER, which is
  // correct: that string is stamped into tokens and validated, never dialled.
  endpoint: process.env.COGNITO_ENDPOINT_HOST?.replace('localhost', '127.0.0.1'),
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

/**
 * `role` defaults to `admin` because most of what these suites do -- creating
 * products, events and flows -- is now behind `@Roles('admin')`. Pass `buyer`
 * to mint the token a shopper actually holds, which is what the role-boundary
 * assertions use.
 */
export async function tokenFor(
  tenantId: string,
  username: string,
  role: string = 'admin',
): Promise<string> {
  const poolId = process.env.COGNITO_USER_POOL_ID!;
  const clientId = process.env.COGNITO_CLIENT_ID!;
  const attributes = [
    { Name: 'custom:tenant_id', Value: tenantId },
    { Name: 'custom:role', Value: role },
  ];

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: username,
        MessageAction: 'SUPPRESS',
        UserAttributes: attributes,
      }),
    );
  } catch (err) {
    if ((err as Error).name !== 'UsernameExistsException') throw err;

    // The user already exists, possibly from an earlier test that requested
    // a different tenant for this same username. Force the attribute to the
    // tenant this call actually asked for -- silently reusing whatever
    // tenant the user happened to have would let a caller mint a token for
    // the wrong tenant with no error, which is exactly the kind of bug a
    // cross-tenant isolation test must not be able to hide.
    await client.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: poolId,
        Username: username,
        UserAttributes: attributes,
      }),
    );
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    }),
  );

  const res = await client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD },
    }),
  );

  return res.AuthenticationResult!.IdToken!;
}

export async function authHeaders(
  tenantId: string,
  username: string,
  role: string = 'admin',
): Promise<Record<string, string>> {
  return {
    authorization: `Bearer ${await tokenFor(tenantId, username, role)}`,
    'content-type': 'application/json',
  };
}

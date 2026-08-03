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
  endpoint: process.env.COGNITO_ENDPOINT_HOST,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

export async function tokenFor(tenantId: string, username: string): Promise<string> {
  const poolId = process.env.COGNITO_USER_POOL_ID!;
  const clientId = process.env.COGNITO_CLIENT_ID!;

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: username,
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
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
        UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
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

  // The ID token, not the access token: Cognito only puts `custom:` attributes
  // on ID tokens without a pre-token-generation trigger.
  return res.AuthenticationResult!.IdToken!;
}

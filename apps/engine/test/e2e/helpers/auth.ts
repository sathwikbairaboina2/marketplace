import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
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

export async function authHeaders(tenantId: string, username: string): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await tokenFor(tenantId, username)}`, 'content-type': 'application/json' };
}

import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const POOL_NAME = 'marketplace';
const CLIENT_NAME = 'marketplace-engine';

export async function ensureUserPool(): Promise<{ userPoolId: string; clientId: string }> {
  const cognito = new CognitoIdentityProviderClient({ endpoint: process.env.COGNITO_ENDPOINT });

  const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  let userPoolId = pools.UserPools?.find((p) => p.Name === POOL_NAME)?.Id;

  if (!userPoolId) {
    const created = await cognito.send(
      new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        Schema: [{ Name: 'tenant_id', AttributeDataType: 'String', Mutable: true }],
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

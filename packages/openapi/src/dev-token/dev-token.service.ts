import { Inject, Injectable } from '@nestjs/common';
import { DEV_TOKEN_ENV, DevTokenEnv } from './dev-token.env';

const PASSWORD = 'Passw0rd!';

/**
 * Mints a real Cognito ID token for a fixed dev identity. Mirrors
 * `apps/*\/test/e2e/helpers/auth.ts`'s `tokenFor` exactly: AdminCreateUser
 * (tolerating UsernameExistsException) -> AdminUpdateUserAttributes forcing
 * `custom:tenant_id` -> AdminSetUserPassword -> InitiateAuth with
 * USER_PASSWORD_AUTH.
 *
 * `@aws-sdk/client-cognito-identity-provider` is a devDependency here and in
 * both apps, reached only through this dynamic import, evaluated at call time
 * -- never at module-load time -- so a build that never invokes `mint()` never
 * needs the package to resolve.
 */
@Injectable()
export class DevTokenService {
  constructor(@Inject(DEV_TOKEN_ENV) private readonly env: DevTokenEnv) {}

  async mint(): Promise<string> {
    const {
      CognitoIdentityProviderClient,
      AdminCreateUserCommand,
      AdminUpdateUserAttributesCommand,
      AdminSetUserPasswordCommand,
      InitiateAuthCommand,
    } = await import('@aws-sdk/client-cognito-identity-provider');

    const userPoolId = this.env.COGNITO_USER_POOL_ID!;
    const clientId = this.env.COGNITO_CLIENT_ID!;
    const username = this.env.DEV_USERNAME;
    const tenantId = this.env.DEV_TENANT_ID;

    const client = new CognitoIdentityProviderClient({
      region: this.env.AWS_REGION,
      endpoint: this.env.COGNITO_ENDPOINT,
    });

    try {
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: username,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'custom:tenant_id', Value: tenantId },
            // The docs page is for trying every route, and the engine's writes
            // are admin-only. A dev token that could only read would make
            // "Try it out" answer 403 for half the document.
            { Name: 'custom:role', Value: 'admin' },
          ],
        }),
      );
    } catch (err) {
      if ((err as Error).name !== 'UsernameExistsException') throw err;

      // The user survives from an earlier run. Force the attribute to the
      // tenant this service is configured for -- reusing whatever tenant the
      // user happened to carry would hand out a token for the wrong tenant
      // with no error, exactly as `test/e2e/helpers/auth.ts` guards against.
      await client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: username,
          UserAttributes: [
            { Name: 'custom:tenant_id', Value: tenantId },
            { Name: 'custom:role', Value: 'admin' },
          ],
        }),
      );
    }

    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
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
}

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Sign-in runs server-side, unlike every other call this app makes.
 *
 * Two reasons. It removes any dependency on cognito-local emitting CORS
 * headers, which is unverified and outside our control; and it is the shape a
 * production deployment keeps, where the client id and any client secret stay
 * off the browser.
 *
 * Minting here is safe despite this container reaching Cognito over the
 * internal `cognito-local:9229` endpoint while the engine validates
 * `JWT_ISSUER` as `http://localhost:9229/<poolId>`: cognito-local stamps `iss`
 * from its own configured issuer domain, not from the request's Host header.
 * The engine's own /dev/token endpoint already depends on this.
 */
export async function POST(request: Request) {
  const { username, password } = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return Response.json({ detail: 'username and password are required' }, { status: 400 });
  }

  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!clientId || !process.env.COGNITO_ENDPOINT) {
    return Response.json({ detail: 'auth is not configured' }, { status: 503 });
  }

  const cognito = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.COGNITO_ENDPOINT,
  });

  try {
    const res = await cognito.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }),
    );

    const token = res.AuthenticationResult?.IdToken;
    if (!token) return Response.json({ detail: 'no id token returned' }, { status: 502 });
    return Response.json({ token });
  } catch {
    // Deliberately not echoing the Cognito error: "user not found" and "wrong
    // password" are the same answer as far as a client is concerned.
    return Response.json({ detail: 'invalid credentials' }, { status: 401 });
  }
}

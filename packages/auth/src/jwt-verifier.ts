import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthError } from './errors';
import { principalFromClaims } from './claims';
import { TenantPrincipal } from './tenant-context';

export interface JwtVerifierOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
  /**
   * Called with the raw verification failure (a JWKS fetch timeout, an
   * IdP outage, a bad signature, ...) before it is replaced with the
   * generic AuthError below. The client must only ever see "token
   * verification failed" -- internals must not leak into the response --
   * but the detail must not silently vanish either, so a consumer that has
   * a logger (e.g. the Engine's Nest wrapper) should wire one in here. This
   * package stays framework-free, so it cannot log this itself.
   */
  onVerificationError?: (err: unknown) => void;
}

export interface JwtVerifier {
  verify(token: string): Promise<TenantPrincipal>;
}

export function createJwtVerifier(opts: JwtVerifierOptions): JwtVerifier {
  // Lazy: createRemoteJWKSet makes no network call until the first verification,
  // and refetches on an unrecognized `kid`.
  const jwks = createRemoteJWKSet(new URL(opts.jwksUri));

  return {
    async verify(token: string): Promise<TenantPrincipal> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: opts.issuer,
          audience: opts.audience,
        });
        return principalFromClaims(payload as Record<string, unknown>);
      } catch (err) {
        if (err instanceof AuthError) throw err;
        opts.onVerificationError?.(err);
        throw new AuthError('token verification failed');
      }
    },
  };
}

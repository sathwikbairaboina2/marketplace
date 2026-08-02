import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ENV, EnvConfig } from '../config/env.schema';
import { TenantPrincipal } from '../common/tenant-context';
import { principalFromClaims } from './claims';

@Injectable()
export class JwtVerifier {
  private readonly logger = new Logger(JwtVerifier.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    // Lazy: no network call until the first token is verified.
    this.jwks = createRemoteJWKSet(new URL(env.JWKS_URI));
  }

  async verify(token: string): Promise<TenantPrincipal> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
      });
      return principalFromClaims(payload as Record<string, unknown>);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // The client only ever sees "token verification failed" -- a JWKS
      // fetch timeout or a cognito-local/Cognito outage must not leak
      // internals into the HTTP response, but it must not vanish either.
      this.logger.warn(`JWT verification failed: ${(err as Error).message}`, (err as Error).stack);
      throw new UnauthorizedException('token verification failed');
    }
  }
}

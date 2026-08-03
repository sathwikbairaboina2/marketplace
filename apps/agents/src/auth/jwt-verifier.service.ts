import { Inject, Injectable, Logger } from '@nestjs/common';
import { createJwtVerifier, JwtVerifier, TenantPrincipal } from '@marketplace/auth';
import { ENV, EnvConfig } from '../config/env.schema';

@Injectable()
export class JwtVerifierService {
  private readonly logger = new Logger(JwtVerifierService.name);
  private readonly verifier: JwtVerifier;

  constructor(@Inject(ENV) env: EnvConfig) {
    this.verifier = createJwtVerifier({
      jwksUri: env.JWKS_URI,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      // @marketplace/auth is framework-free and cannot log. The client only
      // ever sees "token verification failed" -- a JWKS fetch timeout or a
      // cognito-local/Cognito outage must not leak internals into the
      // response, but it must not vanish either.
      onVerificationError: (err) => {
        this.logger.warn(`JWT verification failed: ${(err as Error).message}`, (err as Error).stack);
      },
    });
  }

  verify(token: string): Promise<TenantPrincipal> {
    return this.verifier.verify(token);
  }
}

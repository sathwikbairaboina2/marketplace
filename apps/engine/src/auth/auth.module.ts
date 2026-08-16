import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifier } from './jwt-verifier';
import { MeController } from './me.controller';
import { ProblemThrottlerGuard } from '../common/throttler';
import { RolesGuard } from './roles.guard';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  controllers: [MeController],
  providers: [
    JwtVerifier,
    // Order matters, and this is the only place it can be settled: Nest runs
    // APP_GUARDs in the order their modules initialise, and this module is
    // imported by the root, so a guard registered in the root would run after
    // these no matter how it was written.
    //
    // The rate limiter goes first, ahead of authentication. A limiter that only
    // applies to requests which already carry a valid token protects nothing
    // that needs protecting -- an anonymous flood, or someone working through a
    // list of passwords, never reaches it.
    { provide: APP_GUARD, useClass: ProblemThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifier } from './jwt-verifier';
import { MeController } from './me.controller';
import { RolesGuard } from './roles.guard';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  controllers: [MeController],
  providers: [
    JwtVerifier,
    // Order matters: Nest runs APP_GUARDs in registration order, and RolesGuard
    // reads the principal JwtAuthGuard puts on the request.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifier } from './jwt-verifier';
import { MeController } from './me.controller';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  controllers: [MeController],
  providers: [
    JwtVerifier,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}

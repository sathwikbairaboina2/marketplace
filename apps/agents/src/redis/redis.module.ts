import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: EnvConfig) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

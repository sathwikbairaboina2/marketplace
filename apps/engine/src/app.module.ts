import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PersistenceModule } from './persistence/persistence.module';
import { RedisModule } from './redis/redis.module';
import { RegistryModule } from './registry/registry.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
      },
    }),
    ConfigModule,
    AuthModule,
    HealthModule,
    PersistenceModule,
    RedisModule,
    RegistryModule,
  ],
})
export class AppModule {}

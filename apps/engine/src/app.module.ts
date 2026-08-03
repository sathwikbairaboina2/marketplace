import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PersistenceModule } from './persistence/persistence.module';
import { RedisModule } from './redis/redis.module';
import { RegistryModule } from './registry/registry.module';
import { ProductsModule } from './products/products.module';
import { EventsModule } from './events/events.module';
import { OrdersModule } from './orders/orders.module';
import { BookingsModule } from './bookings/bookings.module';
import { IdempotencyModule } from './idempotency/idempotency.module';

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
    ProductsModule,
    EventsModule,
    OrdersModule,
    BookingsModule,
    IdempotencyModule,
  ],
})
export class AppModule {}

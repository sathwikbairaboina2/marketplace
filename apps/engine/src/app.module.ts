import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { DevTokenModule } from '@marketplace/openapi';
import { ConfigModule } from './config/config.module';
import { loggerOptions } from './config/logger.options';
import { DevTokenEnvSchema, ENV, EnvConfig } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { GuestModule } from './guest/guest.module';
import { AuthModule } from './auth/auth.module';
import { PersistenceModule } from './persistence/persistence.module';
import { RedisModule } from './redis/redis.module';
import { RegistryModule } from './registry/registry.module';
import { ProductsModule } from './products/products.module';
import { EventsModule } from './events/events.module';
import { OrdersModule } from './orders/orders.module';
import { BookingsModule } from './bookings/bookings.module';
import { FlowsModule } from './flows/flows.module';
import { SettingsModule } from './settings/settings.module';
import { StorefrontModule } from './storefront/storefront.module';
import { ShopsModule } from './shops/shops.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ThreadsModule } from './threads/threads.module';
import { UploadsModule } from './uploads/uploads.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { MessagingModule } from './messaging/messaging.module';
import { CartModule } from './cart/cart.module';
import { CheckoutModule } from './checkout/checkout.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        ...loggerOptions,
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
      },
    }),
    ConfigModule,
    // Async, so the limit comes from the validated environment at
    // instantiation. Read synchronously here it would be captured when this
    // file is first imported -- before anything has had a chance to configure
    // it, which is exactly how a test asking for a limit of five got the
    // default of six hundred.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: EnvConfig) => [
        { ttl: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT },
      ],
    }),
    DevTokenModule.registerIfEnabled(DevTokenEnvSchema.parse(process.env)),
    AuthModule,
    GuestModule,
    HealthModule,
    PersistenceModule,
    RedisModule,
    RegistryModule,
    ProductsModule,
    EventsModule,
    OrdersModule,
    BookingsModule,
    FlowsModule,
    SettingsModule,
    StorefrontModule,
    ShopsModule,
    PipelineModule,
    ThreadsModule,
    CartModule,
    CheckoutModule,
    StatsModule,
    // Read from process.env rather than ENV: `registerIfEnabled` decides
    // whether a controller exists while @Module's metadata is evaluated, long
    // before ConfigModule instantiates ENV. Same reasoning as DevTokenModule
    // above.
    UploadsModule.registerIfEnabled({
      S3_BUCKET: process.env.S3_BUCKET,
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
    }),
    IdempotencyModule,
    MessagingModule,
  ],
})
export class AppModule {}

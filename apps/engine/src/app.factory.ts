import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { setupOpenApi } from '@marketplace/openapi';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, EnvConfig } from './config/env.schema';

/**
 * Everything `bootstrap()` does except `listen`. Kept out of `main.ts` on
 * purpose: `main.ts` ends with a top-level `void bootstrap()`, so a test that
 * imported the seam from there would start a real listener on `env.PORT` just
 * by importing the module.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Sensible defaults for an API: nosniff, no framing, a referrer policy, and
  // no `x-powered-by` announcing the framework to anyone deciding which CVE
  // list to work through.
  //
  // `contentSecurityPolicy` is off deliberately. This service answers JSON to a
  // browser on another origin; the only HTML it serves is the Swagger UI, which
  // helmet's default policy breaks (it loads its own inline bundle). A CSP that
  // matters belongs on the console, which is what actually renders documents.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  // Without this, Nest never wires SIGTERM/SIGINT to the lifecycle it manages, so
  // `SqsConsumerService.onModuleDestroy` -- which stops the poll loop and closes the SQS
  // client -- would only ever run when a test calls `app.close()` directly, never on a real
  // `docker stop`/`docker compose down`. Node's own default SIGTERM handling would still kill
  // the process (so nothing hangs), just without giving the consumer a chance to finish its
  // current receive/handle cycle first.
  app.enableShutdownHooks();

  const env = app.get<EnvConfig>(ENV);
  if (env.DOCS_ENABLED) {
    setupOpenApi(app, { title: 'MarketplaceEngine', version: '1.0.0' });
  }

  if (env.CORS_ORIGINS) {
    app.enableCors({
      origin: env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      // Listed explicitly rather than reflected back from the request:
      // `Idempotency-Key` is required on POST /orders and POST /bookings, and a
      // preflight that silently drops it turns every order the browser places
      // into an opaque CORS failure with no server-side trace.
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      // PUT: the settings routes update in place -- without it the preflight
      // rejects the request and the browser never sends the PUT at all.
      //
      // PATCH: the same trap, one route later. Editing a product from the
      // cockpit sent a correct body to a correct URL and nothing arrived,
      // because the preflight for a method missing from this list fails before
      // the request is ever made. A method added to a controller has to be
      // added here too, or it works from a terminal and only from a terminal.
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    });
  }

  return app;
}

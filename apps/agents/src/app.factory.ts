import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
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
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  const env = app.get<EnvConfig>(ENV);
  if (env.DOCS_ENABLED) {
    setupOpenApi(app, { title: 'MarketplaceAgents', version: '1.0.0' });
  }

  if (env.CORS_ORIGINS) {
    app.enableCors({
      origin: env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      // The same discipline the engine documents: a method or header a
      // controller answers has to be named here, or the browser refuses
      // before it sends anything, and it works from a terminal and only
      // from a terminal.
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'OPTIONS'],
    });
  }

  return app;
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, EnvConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
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
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();

import 'reflect-metadata';
import { createApp } from './app.factory';
import { ENV, EnvConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const env = app.get<EnvConfig>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();

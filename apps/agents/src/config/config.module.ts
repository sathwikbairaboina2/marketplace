import { Global, Module } from '@nestjs/common';
import { ENV, EnvSchema } from './env.schema';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => EnvSchema.parse(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}

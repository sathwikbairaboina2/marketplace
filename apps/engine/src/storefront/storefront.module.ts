import { Module } from '@nestjs/common';
import { ENV, EnvConfig } from '../config/env.schema';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  controllers: [StorefrontController],
  providers: [
    {
      provide: StorefrontService,
      inject: [DynamoRepository, ENV],
      // The service takes a plain capability boolean rather than the env
      // object: what it needs to know is "can this deployment render images",
      // not where the renderer lives.
      useFactory: (repo: DynamoRepository, env: EnvConfig) =>
        new StorefrontService(repo, Boolean(env.IMAGE_GEN_URL)),
    },
  ],
  exports: [StorefrontService],
})
export class StorefrontModule {}

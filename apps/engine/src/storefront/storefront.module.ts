import { Module } from '@nestjs/common';
import { ENV, EnvConfig } from '../config/env.schema';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { UploadsService } from '../uploads/uploads.service';
import { ImageGenClient } from './image-gen.client';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  controllers: [StorefrontController],
  providers: [
    {
      provide: StorefrontService,
      inject: [DynamoRepository, ENV],
      // Image generation needs both a renderer (IMAGE_GEN_URL) and object
      // storage to put the result in; either missing wires nulls and the
      // capability reads false. UploadsService is constructed here rather than
      // imported because UploadsModule only provides it when its own dynamic
      // registration enabled the upload routes -- which shares the same
      // storage condition this factory checks.
      useFactory: (repo: DynamoRepository, env: EnvConfig) => {
        const storage = Boolean(env.S3_BUCKET && env.S3_PUBLIC_ENDPOINT);
        const imageGen = env.IMAGE_GEN_URL
          ? new ImageGenClient({
              url: env.IMAGE_GEN_URL,
              checkpoint: env.IMAGE_GEN_CHECKPOINT,
              timeoutMs: env.IMAGE_GEN_TIMEOUT_MS,
            })
          : null;
        const uploads = storage && imageGen ? new UploadsService(env) : null;
        return new StorefrontService(repo, uploads ? imageGen : null, uploads);
      },
    },
  ],
  exports: [StorefrontService],
})
export class StorefrontModule {}

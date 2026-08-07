import { DynamicModule, Module } from '@nestjs/common';
import { EnvConfig } from '../config/env.schema';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({})
export class UploadsModule {
  /**
   * No controller and no providers unless object storage is configured, so a
   * deployment without a bucket 404s the route from the router rather than
   * exposing an endpoint that exists and then fails at call time. Same shape as
   * `DevTokenModule.registerIfEnabled` in @marketplace/openapi.
   *
   * Both values are required: a bucket with no public endpoint would sign URLs
   * against `undefined`.
   */
  static registerIfEnabled(
    env: Pick<EnvConfig, 'S3_BUCKET' | 'S3_PUBLIC_ENDPOINT'>,
  ): DynamicModule {
    if (!env.S3_BUCKET || !env.S3_PUBLIC_ENDPOINT) return { module: UploadsModule };

    return {
      module: UploadsModule,
      controllers: [UploadsController],
      providers: [UploadsService],
    };
  }
}

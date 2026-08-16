import {
  Controller,
  HttpCode,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedImage } from '@marketplace/contracts';
import { Roles } from '../auth/roles.decorator';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { IncomingFile, UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    @Inject(ENV) private readonly env: EnvConfig,
  ) {}

  // 200, not 201: the created thing is an object in a bucket, not a resource in
  // this API, and there is no route at which it could subsequently be found.
  @Post('product-image')
  @HttpCode(200)
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      // Enforced by multer while the request is being read, so an oversized
      // upload is cut off mid-stream rather than buffered in full and then
      // refused. This is the size limit -- LocalStack does not honour a
      // presigned policy's content-length-range, so the engine owns it.
      limits: { fileSize: Number(process.env.MAX_IMAGE_BYTES ?? 5_242_880) },
    }),
  )
  async upload(@UploadedFile() file?: IncomingFile): Promise<UploadedImage> {
    if (!file) {
      throw new ProblemException(
        'invalid-request',
        400,
        'No file uploaded',
        'send the image as a multipart form field named `file`',
      );
    }
    return this.uploads.store(file);
  }
}

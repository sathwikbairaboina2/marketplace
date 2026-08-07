import { Controller, HttpCode, Post } from '@nestjs/common';
import { PresignUpload, PresignUploadSchema, PresignedUpload } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  // 200, not 201: signing creates nothing. The object does not exist until the
  // browser completes the upload this response describes.
  //
  // An unsupported content type is rejected by ZodBody against
  // `PresignUploadSchema` -- before anything is signed -- rather than being
  // signed and left for S3 to refuse.
  @Post('product-image')
  @HttpCode(200)
  presign(@ZodBody(PresignUploadSchema) body: PresignUpload): Promise<PresignedUpload> {
    return this.uploads.presign(body);
  }
}

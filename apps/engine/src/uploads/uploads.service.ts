import { Inject, Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { UploadedImage } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { buildObjectKey } from './object-key';
import { isAllowedContentType, sniffImageType } from './image-type';

export interface IncomingFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class UploadsService {
  private readonly client: S3Client;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.client = new S3Client({
      region: env.AWS_REGION,
      // The INTERNAL endpoint: this client is the engine writing to storage.
      // The URL handed back to the browser is built from S3_PUBLIC_ENDPOINT
      // instead, because a compose hostname does not resolve in a browser.
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
    });
  }

  async store(file: IncomingFile): Promise<UploadedImage> {
    if (!isAllowedContentType(file.mimetype)) {
      throw new ProblemException(
        'unsupported-media-type',
        422,
        'Unsupported image type',
        `${file.mimetype} is not an accepted image type`,
        { received: file.mimetype },
      );
    }

    // The declared type got us this far; the bytes decide. Without this, an
    // HTML or SVG payload could be uploaded as `image/png` and then served,
    // publicly, from the media bucket under that content type.
    const actual = sniffImageType(file.buffer);
    if (actual === null) {
      throw new ProblemException(
        'unsupported-media-type',
        422,
        'Not a recognised image',
        'the file contents do not match any accepted image format',
      );
    }
    if (actual !== file.mimetype) {
      throw new ProblemException(
        'unsupported-media-type',
        422,
        'Image type mismatch',
        `the file was declared as ${file.mimetype} but its contents are ${actual}`,
        { declared: file.mimetype, actual },
      );
    }

    const { tenantId } = currentPrincipal();
    const key = buildObjectKey(tenantId, newId(), file.originalname);
    const bucket = this.env.S3_BUCKET!;

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        // Stored from the sniffed value, not the declared one, so what is
        // served back can never contradict what was written.
        ContentType: actual,
      }),
    );

    return { objectUrl: `${this.env.S3_PUBLIC_ENDPOINT}/${bucket}/${key}` };
  }
}

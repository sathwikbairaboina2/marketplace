import { Inject, Injectable } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { PresignUpload, PresignedUpload } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { buildObjectKey } from './object-key';

/** Five minutes is ample for a browser upload and short enough that a leaked
 *  link is not a durable write capability. */
const EXPIRES_SECONDS = 300;

@Injectable()
export class UploadsService {
  private readonly client: S3Client;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.client = new S3Client({
      region: env.AWS_REGION,
      // The PUBLIC endpoint, deliberately. This client exists solely to sign
      // URLs the browser will use, and a presigned signature is bound to the
      // host it was signed for -- signing against S3_ENDPOINT would produce
      // URLs that fail their signature check in the browser.
      endpoint: env.S3_PUBLIC_ENDPOINT,
      forcePathStyle: true,
    });
  }

  async presign(input: PresignUpload): Promise<PresignedUpload> {
    const { tenantId } = currentPrincipal();
    const key = buildObjectKey(tenantId, newId(), input.filename);
    const bucket = this.env.S3_BUCKET!;

    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: bucket,
      Key: key,
      // The policy is the enforcement point. S3 rejects a body outside this
      // range, or one whose Content-Type differs from what was signed --
      // neither limit depends on the client telling the truth about the file
      // it is sending, which a presigned PUT would have had to.
      Conditions: [
        ['content-length-range', 0, this.env.MAX_IMAGE_BYTES],
        ['eq', '$Content-Type', input.contentType],
      ],
      Fields: { 'Content-Type': input.contentType },
      Expires: EXPIRES_SECONDS,
    });

    return { url, fields, objectUrl: `${this.env.S3_PUBLIC_ENDPOINT}/${bucket}/${key}` };
  }
}

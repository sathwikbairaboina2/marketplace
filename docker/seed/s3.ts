import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';

export const BUCKET_NAME = 'marketplace-media';

// No CORS rule here on purpose. The browser never talks to this bucket: it
// posts files to the engine, which writes them with its own credentials, and it
// reads images back through <img> tags -- which are not CORS requests.

export async function ensureBucket(): Promise<string> {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    // LocalStack serves http://host/<bucket>/<key>, not virtual-host addressing.
    forcePathStyle: true,
  });

  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
    console.log(`bucket ${BUCKET_NAME} already exists`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
  }

  // Public read on objects, and nothing else. Product photographs exist to be
  // displayed: signing a read URL per thumbnail would cost a round-trip per
  // image on every grid and defeat browser caching. `s3:GetObject` alone means
  // there is no ListBucket, so the bucket cannot be enumerated -- a URL has to
  // be known to be useful.
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: BUCKET_NAME,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadObjects',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
          },
        ],
      }),
    }),
  );

  return BUCKET_NAME;
}

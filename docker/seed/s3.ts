import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';

export const BUCKET_NAME = 'marketplace-media';

// The console's origin. The browser posts the file directly to S3, so it is S3
// -- not the engine -- that has to allow this origin. The engine's own
// CORS_ORIGINS has nothing to do with it.
const CONSOLE_ORIGIN = 'http://localhost:3002';

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

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['POST', 'GET', 'HEAD'],
            AllowedOrigins: [CONSOLE_ORIGIN],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag', 'Location'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );

  return BUCKET_NAME;
}

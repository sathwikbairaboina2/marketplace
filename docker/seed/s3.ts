import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { CatalogueRecord } from './catalogue';

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

/**
 * Uploads the product photographs the catalogue fixture points at.
 *
 * The keys are not listed here: they are read back out of the fixture's own
 * image URLs, so a re-captured catalogue cannot end up pointing at objects this
 * function never uploads. Only the file basename has to exist under
 * `fixtures/images/`.
 */
export async function seedImages(records: CatalogueRecord[]): Promise<number> {
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, forcePathStyle: true });
  const prefix = `/${BUCKET_NAME}/`;
  let uploaded = 0;

  for (const record of records) {
    const images = Array.isArray(record.images) ? (record.images as string[]) : [];
    for (const url of images) {
      const at = url.indexOf(prefix);
      if (at === -1) continue;
      const key = url.slice(at + prefix.length);
      const file = path.join(__dirname, 'fixtures', 'images', path.basename(key));

      let body: Buffer;
      try {
        body = readFileSync(file);
      } catch {
        // A missing photograph must not fail the whole seed: the product still
        // renders from its initials, which is exactly what every product
        // created through the UI looks like.
        console.warn(`no fixture image for ${key} (expected ${path.basename(key)})`);
        continue;
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: key.endsWith('.png') ? 'image/png' : 'image/jpeg',
        }),
      );
      uploaded += 1;
    }
  }

  console.log(`uploaded ${uploaded} product image(s)`);
  return uploaded;
}

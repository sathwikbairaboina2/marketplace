import { writeFileSync, rmSync } from 'node:fs';
import { ensureTable } from './dynamo';
import { ensureQueues } from './sqs';
import { ensureUserPool, ensureDemoUsers, DEMO_USERS, DEMO_PASSWORD } from './cognito';
import { ensureBucket, seedImages } from './s3';
import { loadCatalogue, seedCatalogue } from './catalogue';

async function main(): Promise<void> {
  // A stale .env.generated from a previous successful run must not survive a
  // failed run: verify.test.ts reads whatever is on disk, so a partial
  // failure that left the old file in place would validate yesterday's
  // infrastructure instead of failing loudly. Removing it up front means a
  // run that dies partway through leaves no file at all.
  rmSync(process.env.ENV_OUT!, { force: true });

  await ensureTable();
  const { queueUrl, dlqUrl } = await ensureQueues();
  const { userPoolId, clientId } = await ensureUserPool();
  const subs = await ensureDemoUsers(userPoolId);
  const bucket = await ensureBucket();

  // Catalogue last: it needs the table, the bucket, and today's `sub` values.
  const catalogue = loadCatalogue();
  await seedCatalogue(subs);
  await seedImages(catalogue);

  // Three origins for one cognito-local, each for a different reader.
  //
  // COGNITO_ENDPOINT_HOST is where a harness on the host reaches it: the
  // published port. JWKS_URI is fetched from inside the engine container, so it
  // uses the compose service name. JWT_ISSUER is neither: cognito-local stamps
  // `iss` from its own configured issuer domain (its default,
  // `http://localhost:9229`, whatever port the container is published on) and
  // never from the request's Host header, and the engine compares the claim as
  // a string. Confirmed by minting a token through the published port and
  // reading the claim back.
  //
  // Against real Cognito all three share one host; this asymmetry lives
  // entirely in configuration, so no code branches on environment.
  const hostOrigin = process.env.COGNITO_HOST_ORIGIN ?? 'http://localhost:39229';
  const issuerOrigin = process.env.COGNITO_ISSUER_ORIGIN ?? 'http://localhost:9229';
  const internalOrigin = process.env.COGNITO_ENDPOINT!;

  const lines = [
    `COGNITO_USER_POOL_ID=${userPoolId}`,
    `COGNITO_CLIENT_ID=${clientId}`,
    `COGNITO_ENDPOINT_HOST=${hostOrigin}`,
    `JWT_ISSUER=${issuerOrigin}/${userPoolId}`,
    `JWT_AUDIENCE=${clientId}`,
    `JWKS_URI=${internalOrigin}/${userPoolId}/.well-known/jwks.json`,
    `QUEUE_URL=${queueUrl}`,
    `DLQ_URL=${dlqUrl}`,
    `S3_BUCKET=${bucket}`,
    // Derived from DEMO_USERS rather than repeated in docker-compose.yml: a
    // persona list that drifts from the pool shows the web console a name that
    // cannot sign in, and the failure looks like broken auth rather than stale
    // configuration.
    `DEV_PERSONAS=${DEMO_USERS.map((u) => u.username).join(',')}`,
    `DEV_PASSWORD=${DEMO_PASSWORD}`,
    '',
  ];
  writeFileSync(process.env.ENV_OUT!, lines.join('\n'), 'utf8');
  console.log(`wrote ${process.env.ENV_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { writeFileSync, rmSync } from 'node:fs';
import { ensureTable } from './dynamo';
import { ensureQueues } from './sqs';
import { ensureUserPool, ensureDemoUsers } from './cognito';
import { ensureBucket } from './s3';

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
  await ensureDemoUsers(userPoolId);
  const bucket = await ensureBucket();

  // The issuer and the JWKS URI deliberately use different hosts locally.
  //
  // Tokens are minted by the e2e suite running on the host, so cognito-local
  // stamps `iss` with the host-facing origin. Issuer checking is a string
  // comparison and never a network call, so JWT_ISSUER must match that.
  // Fetching the JWKS *is* a network call made from inside the engine
  // container, so JWKS_URI must use the compose service name.
  //
  // Against real Cognito both values share one host; this asymmetry lives
  // entirely in configuration, so no code branches on environment.
  const hostOrigin = process.env.COGNITO_HOST_ORIGIN ?? 'http://localhost:9229';
  const internalOrigin = process.env.COGNITO_ENDPOINT!;

  const lines = [
    `COGNITO_USER_POOL_ID=${userPoolId}`,
    `COGNITO_CLIENT_ID=${clientId}`,
    `COGNITO_ENDPOINT_HOST=${hostOrigin}`,
    `JWT_ISSUER=${hostOrigin}/${userPoolId}`,
    `JWT_AUDIENCE=${clientId}`,
    `JWKS_URI=${internalOrigin}/${userPoolId}/.well-known/jwks.json`,
    `QUEUE_URL=${queueUrl}`,
    `DLQ_URL=${dlqUrl}`,
    `S3_BUCKET=${bucket}`,
    '',
  ];
  writeFileSync(process.env.ENV_OUT!, lines.join('\n'), 'utf8');
  console.log(`wrote ${process.env.ENV_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

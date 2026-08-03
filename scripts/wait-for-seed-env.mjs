// Waits for docker/.env.generated to exist AND contain every key the engine container needs,
// before the caller brings the `engine` service up in a second `docker compose up`.
//
// Why this exists: `seed` writes this file from inside a container, through a bind mount, to
// the host filesystem. `docker compose up --wait ... seed` returns as soon as the *container*
// has exited successfully -- but on at least one real environment (Docker Desktop for Windows,
// WSL2 backend), the file's write can still be propagating through the bind-mount layer to the
// host's view of the filesystem for a second or two *after* that. A second `docker compose up`
// invocation started immediately afterward resolves `env_file` from the host's filesystem view
// at that moment -- if it loses that race, `engine` is created with some or all of its required
// variables silently absent, and crashes on boot with an opaque "JWT_ISSUER is Required" error.
//
// Polling for existence alone is not enough: a partially-flushed file is exactly the failure
// mode being closed here, and starting the engine against a truncated read would fail just as
// confusingly (a malformed issuer URL) as the original race. So this parses the file on every
// poll and only succeeds once every key the engine actually needs is present and non-empty.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(__dirname, '..', 'docker', '.env.generated');

// Exactly the keys apps/engine/src/config/env.schema.ts requires that only `seed` can produce --
// not every key seed writes (COGNITO_ENDPOINT_HOST and DLQ_URL exist in the file but aren't
// required by the engine), and not the ones already set directly in docker-compose.yml.
const REQUIRED_KEYS = ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWKS_URI', 'QUEUE_URL'];

const POLL_INTERVAL_MS = 250;
// The observed lag on the flaky environment was on the order of one to two seconds; 30s gives
// roughly two orders of magnitude of margin over that before this gives up and fails loudly,
// while still failing fast (in ~120 polls, not minutes) if `seed` genuinely never wrote a valid
// file at all -- e.g. it crashed before reaching the write.
const TIMEOUT_MS = 30_000;

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

function readReadyValues() {
  let text;
  try {
    text = readFileSync(ENV_FILE, 'utf8');
  } catch {
    // Not present yet (or a transient read error mid-write) -- caller keeps polling.
    return null;
  }
  const values = parseEnvFile(text);
  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  return missing.length === 0 ? values : null;
}

async function main() {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const values = readReadyValues();
    if (values) {
      console.log(`docker/.env.generated is complete (${REQUIRED_KEYS.join(', ')} all present).`);
      return;
    }
    if (Date.now() >= deadline) {
      console.error(
        `Timed out after ${TIMEOUT_MS}ms waiting for ${ENV_FILE} to contain ` +
          `${REQUIRED_KEYS.join(', ')}. The seed container should have written this file -- ` +
          `check its logs with "docker compose -f docker/docker-compose.yml logs seed" to see ` +
          `whether it actually completed and what it wrote.`,
      );
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

await main();

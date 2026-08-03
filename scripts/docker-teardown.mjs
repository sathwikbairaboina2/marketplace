// Single definition of "tear the stack down between runs" so `pnpm docker:down` (the documented
// end of the dev loop -- see README.md) and `pnpm e2e`'s automatic teardown can't drift apart and
// disagree about which volumes survive.
//
// Deliberately NOT `docker compose down -v`: that removes every named volume, including
// `ollama-models`, which holds a 4.7GB model pulled by `ollama-init`. Re-downloading it on every
// teardown would cost minutes of wall clock (and real money on a metered connection) for no
// test-isolation benefit -- the model's contents don't change between runs.
//
// The data-plane services do still need to start clean each run, though: plain `down` (no `-v`)
// removes containers, which is enough for dynamodb-local (`-inMemory`) and localstack (no
// persistence configured) since neither has a volume to begin with. `cognito-local` DOES persist
// to a volume, so its pool would otherwise survive and get reused stale -- remove that one volume
// explicitly. `ollama-models` is never named, so it survives untouched.
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: true }).status ?? 1;

run('docker', ['compose', '-f', 'docker/docker-compose.yml', 'down']);
run('docker', ['volume', 'rm', '-f', 'marketplace_cognito-data']);

import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: true }).status ?? 1;

const up = run('pnpm', ['docker:up']);
let code = up;
if (up === 0) {
  code = run('pnpm', ['--filter', '@marketplace/engine', 'test:e2e']);
}
if (code === 0) {
  code = run('pnpm', ['--filter', '@marketplace/agents', 'test:e2e']);
}

// Deliberately NOT `pnpm docker:down` (which is `down -v`): that removes every named volume,
// including `ollama-models`, which holds a 4.7GB model pulled by `ollama-init`. Re-downloading
// it on every `pnpm e2e` run would cost minutes of wall clock (and real money on a metered
// connection) for no test-isolation benefit -- the model's contents don't change between runs.
// The data-plane services do need to start clean each run, though: `down` (no `-v`) removes
// containers, which is enough for dynamodb-local (`-inMemory`) and localstack (no persistence
// configured) since neither has a volume to begin with. `cognito-local` DOES persist to a
// volume, so its pool would otherwise survive and get reused stale -- remove that one volume
// explicitly. `ollama-models` is never named, so it survives untouched.
run('docker', ['compose', '-f', 'docker/docker-compose.yml', 'down']);
run('docker', ['volume', 'rm', '-f', 'marketplace_cognito-data']);
process.exit(code);

// Single definition of "tear the stack down between runs" so `pnpm docker:down` (the documented
// end of the dev loop -- see README.md) and `pnpm e2e`'s automatic teardown can't drift apart and
// disagree about which volumes survive.
//
// Deliberately NOT `docker compose down -v`, and the model is not this stack's to drop anyway:
// the LLM lives on a shared ollama daemon outside this compose project (see docker-compose.yml),
// so a teardown here never touches it.
//
// The data-plane services do still need to start clean each run: plain `down` (no `-v`)
// removes containers, which is enough for dynamodb-local (`-inMemory`) and localstack (no
// persistence configured) since neither has a volume to begin with. `cognito-local` DOES persist
// to a volume, so its pool would otherwise survive and get reused stale -- remove that one volume
// explicitly, by name, so nothing else that happens to be attached is swept up with it.
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: true }).status ?? 1;

const downStatus = run('docker', ['compose', '-f', 'docker/docker-compose.yml', 'down']);
// `docker volume rm -f` on a volume that's already gone exits 0 -- `-f` exists precisely to
// make "nothing to remove" a no-op, not a failure (verified empirically: `docker volume rm -f
// <nonexistent>` returns status 0). So a non-zero exit here is a genuine problem (permission
// error, daemon unreachable mid-command), not a missing volume, and deserves to propagate
// exactly like a `docker compose down` failure would -- this script's caller (`pnpm docker:down`
// in the documented dev loop, and `pnpm docker:down` from inside scripts/e2e.mjs) both rely on
// shell `&&`/exit-code semantics to detect a broken stack, and previously got a false green from
// this file regardless of what either command actually did.
const volStatus = run('docker', ['volume', 'rm', '-f', 'marketplace_cognito-data']);

process.exit(downStatus !== 0 ? downStatus : volStatus);

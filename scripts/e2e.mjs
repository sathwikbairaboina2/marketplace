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

// `pnpm docker:down` itself is the model-preserving teardown (see scripts/docker-teardown.mjs
// for the rationale) -- calling it here means this script and the documented dev-loop command
// share one definition of "clean between runs" instead of two that can drift apart.
run('pnpm', ['docker:down']);
process.exit(code);

import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: true }).status ?? 1;

const up = run('pnpm', ['docker:up']);
let code = up;
if (up === 0) {
  code = run('pnpm', ['--filter', '@marketplace/engine', 'test:e2e']);
}
run('pnpm', ['docker:down']);
process.exit(code);

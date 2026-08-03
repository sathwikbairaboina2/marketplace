// Deletes any host-side docker/.env.generated left over from a previous run, before the
// infra+seed step of `docker:up` starts.
//
// Why this exists: `docker/.env.generated` is a HOST file written by the `seed` container
// through a bind mount. No teardown path ever touches it -- `docker compose down`, even `down
// -v`, only removes containers/networks/volumes, not bind-mounted files that live in the repo
// tree -- so it survives indefinitely between runs until `seed` next overwrites it.
//
// `wait-for-seed-env.mjs` (further down the docker:up chain) waits only for the required keys
// to be PRESENT and non-empty. A stale-but-complete leftover from a PREVIOUS run's Cognito pool
// satisfies that condition perfectly, even before THIS run's `seed` has started rewriting the
// file. And `up --wait seed` only guarantees the seed CONTAINER exited -- not that its
// bind-mount write has become visible on the host yet (a real propagation delay, observed on
// Docker Desktop for Windows/WSL2). So the wait step can pass against the old file, and
// `engine`/`agents` then get force-recreated (da9cf89) against a JWT issuer that no longer
// matches the Cognito pool `cognito-local` is actually serving -- force-recreate can't help
// here, because the *containers* are new but the *file* is old.
//
// Deleting the file here, before `seed` ever runs, means "present and complete" can only mean
// "written by *this* run's seed" -- closing that race without adding a third polling heuristic
// on top of `--wait` and `wait-for-seed-env.mjs`.
import { rmSync } from 'node:fs';

rmSync('docker/.env.generated', { force: true });

import { currentPrincipal } from './tenant-context';
import { ProblemException } from './problem';

/**
 * The service-side half of an admin-only operation. The `@Roles('admin')`
 * decorator on the route is what shows the restriction in the OpenAPI
 * document; this is what protects a non-HTTP caller, and what the unit tests
 * pin. One definition, so the wording and the status cannot drift between the
 * seven places that used to spell it out.
 */
export function assertAdmin(action: string): void {
  if (currentPrincipal().role !== 'admin') {
    throw new ProblemException('forbidden', 403, `Only an admin can ${action}`);
  }
}

import { ProblemException } from '../../common/problem';
import { EngineClient } from '../../engine-client/engine.client';
import { RunContext } from '../context';
import { AgentState } from '../state';

export function makeLoadRegistryNode(deps: { engine: EngineClient }, ctx: RunContext) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.targetEntity) {
      // Unreachable through the graph's edges; an explicit failure beats a
      // silent request for schema "null". Raised as a typed problem, not a
      // bare Error, so a future edge change that made this reachable would
      // surface as `internal-error` rather than an untyped 500.
      throw new ProblemException(
        'internal-error',
        500,
        'Internal Server Error',
        'loadRegistry requires a target entity',
      );
    }

    const registrySnapshot = await deps.engine.getSchema(state.targetEntity, ctx.authToken);
    return { registrySnapshot };
  };
}

import { EngineClient } from '../../engine-client/engine.client';
import { RunContext } from '../context';
import { AgentState } from '../state';

export function makeLoadRegistryNode(deps: { engine: EngineClient }, ctx: RunContext) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.targetEntity) {
      // Unreachable through the graph's edges; an explicit failure beats a
      // silent request for schema "null".
      throw new Error('loadRegistry requires a target entity');
    }

    const registrySnapshot = await deps.engine.getSchema(state.targetEntity, ctx.authToken);
    return { registrySnapshot };
  };
}

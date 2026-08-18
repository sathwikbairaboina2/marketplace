import { PipelineSchema, type UpdatePipeline } from '@marketplace/contracts';
import { request } from './http';

/**
 * Readable by every signed-in member of the tenant; a shop that has never
 * configured one gets the built-in default rather than a 404.
 */
export const getPipeline = () => request('/settings/pipeline', { schema: PipelineSchema });

/**
 * `body.version` is the version the editor loaded. The engine conditions its
 * write on it, so a save from a stale editor is refused with
 * `pipeline-version-conflict` rather than quietly overwriting the save it never
 * saw.
 */
export const savePipeline = (body: UpdatePipeline) =>
  request('/settings/pipeline', { method: 'PUT', body, schema: PipelineSchema });

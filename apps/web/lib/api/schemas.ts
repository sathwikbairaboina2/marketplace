import { SchemaListSchema } from '@marketplace/contracts';
import { request } from './http';

/**
 * One call returns every dynamic entity's schema -- `GET /schemas` maps over
 * `DynamicEntityTypeSchema.options` server-side. So the cache above this is one
 * fetch and one eviction, not four of each.
 */
export const listSchemas = () => request('/schemas', { schema: SchemaListSchema });

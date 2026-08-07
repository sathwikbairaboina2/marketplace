import { type CreateFlow, FlowResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(FlowResponseSchema);

export const listFlows = (limit: number, cursor: string | null) =>
  request('/flows', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getFlow = (id: string) => request(`/flows/${id}`, { schema: FlowResponseSchema });

export const createFlow = (body: CreateFlow) =>
  request('/flows', { method: 'POST', body, schema: FlowResponseSchema });

// 200, not 201: this applies an existing flow's diff, it does not create one.
export const executeFlow = (id: string) =>
  request(`/flows/${id}/execute`, { method: 'POST', schema: FlowResponseSchema });

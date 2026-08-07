import { type CreateEvent, EventResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(EventResponseSchema);

export const listEvents = (limit: number, cursor: string | null) =>
  request('/events', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getEvent = (id: string) => request(`/events/${id}`, { schema: EventResponseSchema });

export const createEvent = (body: CreateEvent) =>
  request('/events', { method: 'POST', body, schema: EventResponseSchema });

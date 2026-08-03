import { z } from 'zod';

// Query params arrive as strings (or are absent); z.coerce.number() converts a present
// `limit` and rejects it with a 400 problem (via ZodQuery) if it isn't a valid integer in
// range, instead of letting `NaN` reach DynamoDB's `Limit` and surface as an opaque 500.
//
// Shared by every `GET /<entity>` list endpoint (products, orders, events, bookings, flows) --
// they all page the same way, so this is the one definition rather than five copies that could
// drift.
export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

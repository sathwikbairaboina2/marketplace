import { z } from 'zod';
import {
  AttributesSchema,
  CurrencySchema,
  IsoDateTimeSchema,
  MinorAmountSchema,
  QuantitySchema,
} from './common';

// `.strict()` must be applied to the object before `.refine()`: `.refine()` returns a
// `ZodEffects` wrapper, which has no `.strict()` of its own -- unknown-field rejection has to be
// baked into the underlying `ZodObject` first.
export const CreateEventSchema = z
  .object({
    title: z.string().min(1).max(200),
    capacity: QuantitySchema,
    startDate: IsoDateTimeSchema,
    endDate: IsoDateTimeSchema,
    basePriceMinor: MinorAmountSchema,
    currency: CurrencySchema,
    attributes: AttributesSchema.default({}),
  })
  .strict()
  .refine((e) => Date.parse(e.endDate) > Date.parse(e.startDate), {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });
export type CreateEvent = z.infer<typeof CreateEventSchema>;

export interface EventRecord {
  PK: string;
  SK: string;
  entityType: 'Event';
  id: string;
  title: string;
  capacity: number;
  bookedCount: number;
  startDate: string;
  endDate: string;
  basePriceMinor: number;
  currency: string;
  createdAt: string;
  attributes: Record<string, unknown>;
}

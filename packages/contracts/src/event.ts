import { z } from 'zod';
import { AttributesSchema, CurrencySchema, IsoDateTimeSchema, MinorAmountSchema } from './common';

export const CreateEventSchema = z
  .object({
    title: z.string().min(1).max(200),
    capacity: z.number().int().positive(),
    startDate: IsoDateTimeSchema,
    endDate: IsoDateTimeSchema,
    basePriceMinor: MinorAmountSchema,
    currency: CurrencySchema,
    attributes: AttributesSchema.default({}),
  })
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

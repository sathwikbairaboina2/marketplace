import { CreateBookingSchema } from './booking';

const valid = { eventId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', ticketQuantity: 2 };

describe('CreateBookingSchema', () => {
  it('accepts a valid booking and applies defaults', () => {
    const parsed = CreateBookingSchema.parse(valid);
    expect(parsed.attributes).toEqual({});
  });

  it('rejects an unknown core field', () => {
    expect(() => CreateBookingSchema.parse({ ...valid, seatNumber: '12A' })).toThrow();
  });

  it('rejects ticketQuantity above the bound', () => {
    expect(() => CreateBookingSchema.parse({ ...valid, ticketQuantity: 101 })).toThrow();
  });
});

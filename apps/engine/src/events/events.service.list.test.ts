import { EventsService } from './events.service';

const repo = { get: jest.fn(), put: jest.fn(), queryPrefix: jest.fn() };
const registry = { validate: jest.fn() };

const event = (id: string, startDate: string) => ({
  PK: 'TENANT#acme',
  SK: `EVENT#${id}`,
  entityType: 'Event',
  id,
  title: `event-${id}`,
  capacity: 10,
  bookedCount: 0,
  basePriceMinor: 1000,
  currency: 'USD',
  startDate,
  endDate: startDate,
  createdAt: '2026-08-20T00:00:00.000Z',
  attributes: {},
});

describe('EventsService.list', () => {
  const service = new EventsService(repo as never, registry as never);

  it('returns the page sorted soonest-first, not in creation order', async () => {
    // Created c, a, b -- ULID/creation order -- but a starts first.
    repo.queryPrefix.mockResolvedValue({
      items: [
        event('c', '2026-12-01T10:00:00.000Z'),
        event('a', '2026-09-01T10:00:00.000Z'),
        event('b', '2026-10-01T10:00:00.000Z'),
      ],
      nextCursor: null,
    });

    const page = await service.list(25, null);
    expect(page.items.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

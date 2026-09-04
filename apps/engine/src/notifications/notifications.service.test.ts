import { NotificationsService } from './notifications.service';

const repo = { put: jest.fn(), queryPrefix: jest.fn() };
const provider = { send: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));

describe('NotificationsService', () => {
  const service = new NotificationsService(repo as never, provider as never);
  beforeEach(() => {
    jest.clearAllMocks();
    repo.put.mockResolvedValue(undefined);
    provider.send.mockResolvedValue(undefined);
  });

  const message = {
    kind: 'order-confirmation' as const,
    to: 'her@example.com',
    subject: 'order K7QY-3PX2',
    body: 'Your order number is K7QY-3PX2.',
    about: 'K7QY-3PX2',
  };

  it('records the message before handing it to the transport', async () => {
    await service.send(message);

    const [sk, record] = repo.put.mock.calls[0];
    expect(sk).toMatch(/^MAIL#/);
    expect(record).toMatchObject({ entityType: 'Mail', to: 'her@example.com' });
    expect(provider.send).toHaveBeenCalledWith({
      to: 'her@example.com',
      subject: message.subject,
      body: message.body,
    });
  });

  // The load-bearing guarantee. A confirmation that cannot be delivered is not
  // a reason to lose the order that caused it, and every caller of this awaits
  // it inside the path that just took someone's money.
  it('does not throw when the transport fails, and keeps the record', async () => {
    provider.send.mockRejectedValue(new Error('smtp is down'));

    await expect(service.send(message)).resolves.toBeUndefined();
    expect(repo.put).toHaveBeenCalled();
  });

  it('does not throw when even the record cannot be written', async () => {
    repo.put.mockRejectedValue(new Error('table is gone'));

    await expect(service.send(message)).resolves.toBeUndefined();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('leaves `about` off a message that is not about anything', async () => {
    await service.send({ ...message, about: undefined });

    expect(repo.put.mock.calls[0][1]).not.toHaveProperty('about');
  });
});

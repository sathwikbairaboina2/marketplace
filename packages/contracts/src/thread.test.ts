import { CreateMessageSchema, MAX_MESSAGE_LENGTH, MessageResponseSchema } from './thread';

describe('CreateMessageSchema', () => {
  it('trims the body', () => {
    expect(CreateMessageSchema.parse({ body: '  hello  ' }).body).toBe('hello');
  });

  it('rejects a whitespace-only body', () => {
    expect(() => CreateMessageSchema.parse({ body: '   ' })).toThrow();
  });

  it('rejects a body past the bound', () => {
    expect(() => CreateMessageSchema.parse({ body: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).toThrow();
  });

  // `.strict()` is what keeps the stage server-chosen: a client that cannot name
  // the stage cannot write into a thread the order has already left.
  it('rejects a client-chosen stage', () => {
    expect(() => CreateMessageSchema.parse({ body: 'hi', stageId: 'anything' })).toThrow();
  });

  it('rejects a client-chosen author', () => {
    expect(() => CreateMessageSchema.parse({ body: 'hi', authorRole: 'seller' })).toThrow();
  });
});

describe('MessageResponseSchema', () => {
  const message = {
    entityType: 'Message' as const,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    orderId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    stageId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    authorUserId: 'u1',
    authorRole: 'buyer' as const,
    body: 'Any news?',
    createdAt: '2026-08-18T10:00:00.000Z',
  };

  it('accepts a message', () => {
    expect(MessageResponseSchema.parse(message).body).toBe('Any news?');
  });

  it('rejects a message carrying the DynamoDB keys', () => {
    expect(MessageResponseSchema.safeParse({ ...message, PK: 'TENANT#a' }).success).toBe(false);
  });

  it('rejects an author role it does not know', () => {
    expect(MessageResponseSchema.safeParse({ ...message, authorRole: 'admin' }).success).toBe(false);
  });
});

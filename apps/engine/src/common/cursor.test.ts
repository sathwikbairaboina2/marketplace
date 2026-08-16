import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor', () => {
  it('round-trips a last evaluated key', () => {
    const key = { PK: 'TENANT#a', SK: 'PRODUCT#01J' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it('produces a url-safe string', () => {
    expect(encodeCursor({ PK: 'TENANT#a?b/c+d' })).not.toMatch(/[+/=]/);
  });

  it('rejects a cursor that is not base64', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(BadRequestException);
  });

  it('rejects a cursor that decodes to a non-object', () => {
    expect(() => decodeCursor(Buffer.from('"a string"').toString('base64url'))).toThrow(
      BadRequestException,
    );
  });

  // Everything below is one defect: a cursor that parses as an object used to be
  // handed straight to DynamoDB as an ExclusiveStartKey. Anything that is not a
  // key of the right shape came back as `ValidationException: Exclusive Start Key
  // must have same size as table's key schema` -- an unhandled 500 on input a
  // client fully controls. The shape is checked here, where it can still be a 400.
  const of = (value: unknown) => encodeCursor(value as Record<string, unknown>);

  it('rejects a cursor missing the sort key', () => {
    expect(() => decodeCursor(of({ PK: 'TENANT#a' }))).toThrow(BadRequestException);
  });

  it('rejects a cursor carrying keys that are not part of any key schema', () => {
    expect(() => decodeCursor(of({ PK: 'TENANT#a', SK: 'PRODUCT#01J', stock: 5 }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a cursor whose values are not strings', () => {
    expect(() => decodeCursor(of({ PK: 'TENANT#a', SK: { nested: true } }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty object', () => {
    expect(() => decodeCursor(of({}))).toThrow(BadRequestException);
  });

  it('accepts a global secondary index key', () => {
    const key = {
      PK: 'TENANT#a',
      SK: 'ORDER#01J',
      GSI1PK: 'TENANT#a#USER#u1',
      GSI1SK: 'ORDER#01J',
    };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });
});

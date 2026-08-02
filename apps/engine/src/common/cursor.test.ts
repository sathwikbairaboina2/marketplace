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
});

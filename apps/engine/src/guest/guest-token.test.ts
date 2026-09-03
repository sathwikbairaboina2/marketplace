import { guestUserId, mintGuest, verifyGuest } from './guest-token';

const SECRET = 'a-secret-long-enough-for-tests';

describe('guest tickets', () => {
  it('mints a ticket the same shop verifies', () => {
    const token = mintGuest(SECRET, 'acme');
    const id = verifyGuest(SECRET, 'acme', token);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(token.startsWith(`${id}.`)).toBe(true);
  });

  it('is bound to the shop it was minted for', () => {
    const token = mintGuest(SECRET, 'acme');
    expect(verifyGuest(SECRET, 'globex', token)).toBeNull();
  });

  it('refuses a tampered id, a tampered signature, a missing or malformed ticket', () => {
    const token = mintGuest(SECRET, 'acme');
    const [id, mac] = token.split('.');
    const otherId = mintGuest(SECRET, 'acme').split('.')[0];
    expect(verifyGuest(SECRET, 'acme', `${otherId}.${mac}`)).toBeNull();
    expect(verifyGuest(SECRET, 'acme', `${id}.${mac.replace(/^./, mac[0] === 'a' ? 'b' : 'a')}`)).toBeNull();
    expect(verifyGuest(SECRET, 'acme', undefined)).toBeNull();
    expect(verifyGuest(SECRET, 'acme', 'no-dot-here')).toBeNull();
    expect(verifyGuest(SECRET, 'acme', `not-a-ulid.${mac}`)).toBeNull();
    expect(verifyGuest(SECRET, 'acme', `${id}.`)).toBeNull();
  });

  it('refuses a ticket signed with another secret', () => {
    const token = mintGuest('another-secret-long-enough-too', 'acme');
    expect(verifyGuest(SECRET, 'acme', token)).toBeNull();
  });

  it('namespaces the guest user id so it can never be a Cognito sub', () => {
    expect(guestUserId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('guest:01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });
});

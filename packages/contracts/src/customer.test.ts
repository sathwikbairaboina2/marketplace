import { normalizeEmailHandle, normalizePhoneHandle } from './order';

describe('how a shop with no accounts knows a returning customer', () => {
  it('treats one number written every way as one person', () => {
    // This is the whole feature. She is looked up by the number she is
    // calling from, and nobody types it the same way twice.
    const forms = [
      '9876543210',
      '98765 43210',
      '+91 98765 43210',
      '+919876543210',
      '098765 43210',
      '(98765) 43210',
    ];
    const handles = new Set(forms.map(normalizePhoneHandle));
    expect(handles.size).toBe(1);
    expect([...handles][0]).toBe('phone:9876543210');
  });

  it('keeps two different numbers apart', () => {
    expect(normalizePhoneHandle('+91 98765 43210')).not.toBe(
      normalizePhoneHandle('+91 90000 00000'),
    );
  });

  it('does not truncate a number that is already short', () => {
    expect(normalizePhoneHandle('4321')).toBe('phone:4321');
  });

  it('folds case and spacing on an address', () => {
    expect(normalizeEmailHandle('  Priya@Example.COM ')).toBe('email:priya@example.com');
  });

  it('never confuses a phone handle with an email one', () => {
    expect(normalizePhoneHandle('9876543210')).not.toBe(normalizeEmailHandle('9876543210@x.co'));
  });
});

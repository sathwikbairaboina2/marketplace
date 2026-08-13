import { AnnouncementSchema } from './settings';

describe('AnnouncementSchema', () => {
  it('accepts a short line and a flag', () => {
    expect(AnnouncementSchema.parse({ text: 'Launch week', enabled: true })).toEqual({
      text: 'Launch week',
      enabled: true,
    });
  });

  it('rejects text past 140 characters', () => {
    expect(() => AnnouncementSchema.parse({ text: 'x'.repeat(141), enabled: true })).toThrow();
  });

  it('rejects a missing flag', () => {
    expect(() => AnnouncementSchema.parse({ text: 'hello' })).toThrow();
  });
});

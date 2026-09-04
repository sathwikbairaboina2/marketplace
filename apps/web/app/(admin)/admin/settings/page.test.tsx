import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminSettingsPage from './page';

const getAnnouncement = vi.fn();
const putAnnouncement = vi.fn();
// The page also carries the contact card, whose own behaviour is not what
// these cases are about: it needs to load without throwing.
const EMPTY_CONTACT = {
  email: '',
  phone: '',
  whatsapp: '',
  address: '',
  delivery: '',
  returns: '',
};
vi.mock('../../../../lib/api/settings', () => ({
  getAnnouncement: () => getAnnouncement(),
  putAnnouncement: (body: unknown) => putAnnouncement(body),
  getShopContact: () => Promise.resolve(EMPTY_CONTACT),
  putShopContact: (body: unknown) => Promise.resolve(body),
  // The deposit card sits on this page too; these cases are about the
  // announcement, and it only needs to load without throwing.
  getDepositPolicy: () =>
    Promise.resolve({ enabled: false, percent: 50, minOrderMinor: 500_000 }),
  putDepositPolicy: (body: unknown) => Promise.resolve(body),
}));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

beforeEach(() => {
  getAnnouncement.mockReset();
  putAnnouncement.mockReset();
  putAnnouncement.mockResolvedValue({ text: '', enabled: false });
});

describe('AdminSettingsPage', () => {
  it('keeps what the seller has typed when the stored value arrives late', async () => {
    // The GET is deliberately still in flight while the seller types. On a cold
    // stack it can take seconds, and a seller who starts writing immediately
    // must not have their sentence replaced by the empty stored one.
    let land: (a: { text: string; enabled: boolean }) => void = () => {};
    getAnnouncement.mockReturnValue(
      new Promise<{ text: string; enabled: boolean }>((resolve) => {
        land = resolve;
      }),
    );

    render(<AdminSettingsPage />);
    await userEvent.type(screen.getByLabelText('Announcement'), 'Launch week');

    await act(async () => {
      land({ text: '', enabled: false });
    });

    expect(screen.getByLabelText('Announcement')).toHaveValue('Launch week');
  });

  it('shows the stored announcement when the seller has typed nothing', async () => {
    getAnnouncement.mockResolvedValue({ text: 'Closed Monday', enabled: true });

    render(<AdminSettingsPage />);
    await act(async () => {});

    expect(screen.getByLabelText('Announcement')).toHaveValue('Closed Monday');
  });

  it('saves the text the seller typed, not an empty one', async () => {
    let land: (a: { text: string; enabled: boolean }) => void = () => {};
    getAnnouncement.mockReturnValue(
      new Promise<{ text: string; enabled: boolean }>((resolve) => {
        land = resolve;
      }),
    );

    render(<AdminSettingsPage />);
    await userEvent.type(screen.getByLabelText('Announcement'), 'Launch week');
    await act(async () => {
      land({ text: '', enabled: false });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save announcement' }));

    expect(putAnnouncement).toHaveBeenCalledWith({ text: 'Launch week', enabled: false });
  });
});

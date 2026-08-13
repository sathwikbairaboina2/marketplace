import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, THEME_STORAGE_KEY } from './theme-context';

function Probe() {
  const { mode, toggle } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={toggle}>flip</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

const stubMatchMedia = (prefersDark: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  });

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    stubMatchMedia(false);
  });

  it('defaults to light when nothing is stored, even if the system prefers dark', async () => {
    // The platform is light-first: a new visitor gets the designed theme, not
    // whichever one their OS happens to be in. Their own toggle still wins.
    stubMatchMedia(true);
    renderProbe();
    await act(async () => {});
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('prefers an explicitly stored choice over the default', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderProbe();
    await act(async () => {});
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('persists a toggle so the choice survives a reload', async () => {
    renderProbe();
    await act(async () => {});
    await act(async () => {
      screen.getByText('flip').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('stamps the mode onto the document element', async () => {
    renderProbe();
    await act(async () => {});
    await act(async () => {
      screen.getByText('flip').click();
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the CSS variables for the active mode', async () => {
    renderProbe();
    await act(async () => {});
    expect(document.documentElement.style.getPropertyValue('--mp-primary')).toBe('#0f766e');
  });

  it('ignores a stored value that is not a mode', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    renderProbe();
    await act(async () => {});
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });
});

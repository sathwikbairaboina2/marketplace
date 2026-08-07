import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom implements no CSS media query engine, so `window.matchMedia` is simply
// absent. ANTD's responsive components (Form's label layout, Grid, Descriptions)
// call it during render and throw. Reporting "never matches" is the correct stub
// for a headless run: layout breakpoints are not what these tests assert.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

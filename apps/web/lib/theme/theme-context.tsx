'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ConfigProvider } from 'antd';
import { antdTheme, cssVars, type Mode } from './tokens';

export const THEME_STORAGE_KEY = 'marketplace.theme';

interface ThemeValue {
  mode: Mode;
  setMode: (m: Mode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const systemMode = (): Mode =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Starts light and corrects on mount. The inline bootstrap script in
  // app/layout.tsx has already stamped `data-theme` before first paint, so
  // nothing flashes -- this state only has to catch up with what the document
  // already says.
  const [mode, setModeState] = useState<Mode>('light');

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    setModeState(stored === 'dark' || stored === 'light' ? stored : systemMode());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    for (const [key, value] of Object.entries(cssVars(mode))) {
      document.documentElement.style.setProperty(key, value);
    }
  }, [mode]);

  const setMode = useCallback((next: Mode) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const toggle = useCallback(
    () => setMode(mode === 'dark' ? 'light' : 'dark'),
    [mode, setMode],
  );

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggle }}>
      <ConfigProvider theme={antdTheme(mode)}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

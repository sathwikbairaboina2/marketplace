'use client';

import { Button, Tooltip } from 'antd';
import { useTheme } from '../lib/theme/theme-context';

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const next = mode === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;

  return (
    <Tooltip title={label}>
      {/* aria-label rather than visible text: the control is an icon, and
          theme.spec.ts selects it by this accessible name. */}
      <Button size="small" aria-label={label} onClick={toggle}>
        {mode === 'dark' ? '☾' : '☀'}
      </Button>
    </Tooltip>
  );
}

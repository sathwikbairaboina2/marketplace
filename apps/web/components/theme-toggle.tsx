'use client';

import { Button, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTheme } from '../lib/theme/theme-context';

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const next = mode === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;

  return (
    <Tooltip title={label}>
      {/* An SVG icon, not a `☀`/`☾` glyph: emoji render differently on every
          platform, do not inherit colour, and are not an icon system.
          aria-label carries the accessible name -- theme.spec selects on it. */}
      <Button
        type="text"
        aria-label={label}
        onClick={toggle}
        icon={mode === 'dark' ? <MoonOutlined /> : <SunOutlined />}
      />
    </Tooltip>
  );
}

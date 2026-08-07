'use client';

import { useState, type ReactNode } from 'react';
import { Button, Drawer, Form, Grid, InputNumber, Space } from 'antd';
import type { FieldDefinition } from '@marketplace/contracts';
import { toFilterItems } from '../lib/schema-fields';

interface Props {
  fields: Record<string, FieldDefinition> | null;
  onApply: (values: Record<string, unknown>) => void;
  onClear: () => void;
}

/**
 * Persistent on the left at desktop width, deliberately.
 *
 * These controls are generated from the tenant's registry, so when an agent
 * proposes a field and someone executes the flow, the new filter appears in
 * front of the user. Behind a drawer, the one thing this platform exists to
 * demonstrate becomes something you have to go looking for.
 *
 * registry-loop.spec.ts depends on this: it asserts `getByLabel(fieldName)` is
 * visible on /products straight after a flow executes.
 */
function RailForm({ fields, onApply, onClear }: Props) {
  return (
    <Form layout="vertical" onFinish={onApply} className="mp-rail-form">
      {/* Labels are a contract -- catalogue.spec fills 'Min price (minor)'. */}
      <Form.Item name="priceMinorMin" label="Min price (minor)">
        <InputNumber min={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="priceMinorMax" label="Max price (minor)">
        <InputNumber min={0} style={{ width: '100%' }} />
      </Form.Item>

      {fields ? toFilterItems(fields) : null}

      <Space>
        <Button type="primary" htmlType="submit">
          Search
        </Button>
        <Button onClick={onClear}>Clear</Button>
      </Space>
    </Form>
  );
}

export function FilterRail(props: Props) {
  const screens = Grid.useBreakpoint();
  const [open, setOpen] = useState(false);
  // Only an explicit false counts as narrow: `md` is undefined on the first
  // render before ANTD measures, and treating that as narrow would hide the
  // generated filters on every desktop load.
  const wide = screens.md !== false;

  if (wide) {
    return (
      <aside className="mp-rail">
        <RailForm {...props} />
      </aside>
    );
  }

  return (
    <>
      <Button className="mp-rail-trigger" onClick={() => setOpen(true)}>
        Filters
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} placement="bottom" height="70%">
        <RailForm
          {...props}
          onApply={(values) => {
            props.onApply(values);
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}

export function ProductGrid({ children }: { children: ReactNode }) {
  return <div className="mp-grid">{children}</div>;
}

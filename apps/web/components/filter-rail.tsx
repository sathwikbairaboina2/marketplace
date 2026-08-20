'use client';

import { useState, type ReactNode } from 'react';
import { Button, Drawer, Form, Grid, Input, InputNumber } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
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
 * registry-loop.spec.ts depends on it: it asserts `getByLabel(fieldName)` is
 * visible on /products straight after a flow executes.
 */
/**
 * Minor units are a storage detail. A shopper types 899 meaning 899 pounds, so
 * the control takes major units and converts here -- the API contract
 * (`priceMinorMin` / `priceMinorMax`) is unchanged, and the products page needs
 * no edit.
 *
 * The x100 convention matches `formatMoney`, which divides by the same. Both
 * are wrong for zero-decimal currencies such as JPY; that is a pre-existing
 * defect and out of scope here.
 */
const MINOR_PER_MAJOR = 100;

/**
 * Accepts a string as well as a number. ANTD's `InputNumber` hands back a
 * number when the spinner is used, but a value typed (or filled by a test)
 * arrives as the raw string -- and a `typeof value === 'number'` guard silently
 * dropped it, sending no price filter at all while the form looked filled in.
 */
const toMinor = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const major = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(major) ? Math.round(major * MINOR_PER_MAJOR) : undefined;
};

function RailForm({ fields, onApply, onClear }: Props) {
  const [form] = Form.useForm();

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={({ priceMin, priceMax, ...rest }) =>
        onApply({
          ...rest,
          priceMinorMin: toMinor(priceMin),
          priceMinorMax: toMinor(priceMax),
        })
      }
      className="mp-rail-form"
    >
      {/* Free text first: it is the broadest question a shopper asks. Matched
          case-insensitively against name, description and category. */}
      <Form.Item name="text" label="Search">
        <Input allowClear placeholder="mugs, walnut, gifts…" maxLength={200} />
      </Form.Item>

      {/* Labels are a contract -- catalogue.spec fills 'Min price'. */}
      <Form.Item name="priceMin" label="Min price">
        <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
      </Form.Item>
      <Form.Item name="priceMax" label="Max price">
        <InputNumber min={0} style={{ width: '100%' }} placeholder="Any" />
      </Form.Item>

      {fields ? toFilterItems(fields) : null}

      <div className="mp-rail-actions">
        <Button type="primary" htmlType="submit" block>
          Search
        </Button>
        <Button
          onClick={() => {
            form.resetFields();
            onClear();
          }}
        >
          Clear
        </Button>
      </div>
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
        <div className="mp-rail-title">
          <FilterOutlined /> Filters
        </div>
        <RailForm {...props} />
      </aside>
    );
  }

  return (
    <>
      <Button className="mp-rail-trigger" icon={<FilterOutlined />} onClick={() => setOpen(true)}>
        Filters
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom"
        height="72%"
        title="Filters"
      >
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

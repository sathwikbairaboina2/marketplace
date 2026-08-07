'use client';

import { Button, DatePicker, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import type { FieldDefinition, FieldType } from '@marketplace/contracts';

/**
 * SearchProductsSchema types `attributes` as
 * `Record<string, string | number | boolean>` -- scalar equality only. Arrays
 * cannot be expressed at all, and an exact match on a timestamp is useless, so
 * `date` is left out too. Range filtering exists only on the core `priceMinor`
 * field, which is a hand-written control rather than a generated one.
 */
export const FILTERABLE_TYPES = [
  'string',
  'number',
  'boolean',
] as const satisfies readonly FieldType[];

const isArrayType = (type: FieldType) => type.endsWith('[]');
const scalarOf = (type: FieldType) => type.replace('[]', '') as FieldType;

/**
 * Tenants name their fields for code, not for reading: `assemblyRequired`,
 * `warranty_months`. Splitting on case and separator boundaries turns those
 * into sentence case for display. The field name itself is untouched -- it is
 * still what the form submits and what the wire carries.
 */
export function toLabel(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .trim()
    .split(/\s+/)
    // An all-caps word is an acronym the tenant meant: SKU stays SKU, not Sku.
    .map((word) => (word === word.toUpperCase() ? word : word.toLowerCase()));

  if (words.length === 0 || words[0] === '') return name;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

function scalarControl(type: FieldType): ReactNode {
  switch (scalarOf(type)) {
    case 'number':
      return <InputNumber style={{ width: '100%' }} />;
    case 'boolean':
      return <Switch />;
    case 'date':
      return <DatePicker style={{ width: '100%' }} />;
    default:
      return <Input />;
  }
}

// Every generated control is namespaced under `attributes`, so `Form` hands
// back `{ attributes: { ... } }` and a tenant-defined field can never collide
// with a core field of the same name.
const nameOf = (field: string) => ['attributes', field];

export function toFormItems(fields: Record<string, FieldDefinition>): ReactNode[] {
  return Object.entries(fields).map(([name, def]) => {
    const label = toLabel(name);
    const rules = def.required ? [{ required: true, message: `${label} is required` }] : undefined;

    // Tag-mode Select handles free-form string and number arrays in one
    // control. `boolean[]` and `date[]` have no sensible tag input, so they get
    // a repeatable list of the scalar control instead.
    if (def.type === 'string[]' || def.type === 'number[]') {
      return (
        <Form.Item key={name} name={nameOf(name)} label={label} rules={rules}>
          <Select mode="tags" tokenSeparators={[',']} open={false} />
        </Form.Item>
      );
    }

    if (isArrayType(def.type)) {
      return (
        <Form.Item key={name} label={label} required={def.required}>
          <Form.List name={nameOf(name)}>
            {(entries, { add, remove }) => (
              <>
                {entries.map((entry) => (
                  <Space key={entry.key} align="baseline">
                    <Form.Item {...entry} noStyle>
                      {scalarControl(def.type)}
                    </Form.Item>
                    <Button onClick={() => remove(entry.name)}>Remove</Button>
                  </Space>
                ))}
                <Button onClick={() => add()}>Add {label.toLowerCase()}</Button>
              </>
            )}
          </Form.List>
        </Form.Item>
      );
    }

    return (
      <Form.Item
        key={name}
        name={nameOf(name)}
        label={label}
        rules={rules}
        initialValue={def.default ?? undefined}
        valuePropName={def.type === 'boolean' ? 'checked' : undefined}
      >
        {scalarControl(def.type)}
      </Form.Item>
    );
  });
}

export function toFilterItems(fields: Record<string, FieldDefinition>): ReactNode[] {
  return Object.entries(fields)
    .filter(([, def]) => (FILTERABLE_TYPES as readonly string[]).includes(def.type))
    .map(([name, def]) => (
      <Form.Item
        key={name}
        name={nameOf(name)}
        label={toLabel(name)}
        valuePropName={def.type === 'boolean' ? 'checked' : undefined}
      >
        {scalarControl(def.type)}
      </Form.Item>
    ));
}

const display = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

export function toDescriptionRows(
  fields: Record<string, FieldDefinition>,
  attributes: Record<string, unknown>,
): Array<{ key: string; label: string; children: ReactNode }> {
  return Object.keys(fields).map((name) => ({
    key: name,
    label: toLabel(name),
    children: display(attributes[name]),
  }));
}

const coerceScalar = (type: FieldType, value: unknown): unknown => {
  switch (scalarOf(type)) {
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      return Boolean(value);
    case 'date':
      // ANTD's DatePicker yields a Dayjs; the wire wants an ISO 8601 string.
      return dayjs.isDayjs(value) ? value.toISOString() : String(value);
    default:
      return String(value);
  }
};

/**
 * ANTD returns Dayjs objects and tag-mode strings; the wire needs ISO strings
 * and real numbers, and the registry's attribute validator rejects the wrong
 * type. This conversion is the difference between a working submit and a 400.
 */
export function toAttributes(
  fields: Record<string, FieldDefinition>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(fields)) {
    const value = values[name];
    // Absent means absent -- sending null for an untouched optional field would
    // fail validation for every type other than the one it was declared as.
    // Note `false` and `0` are values, not absences, and must survive this.
    if (value === undefined || value === null || value === '') continue;

    out[name] = isArrayType(def.type)
      ? (Array.isArray(value) ? value : [value]).map((item) => coerceScalar(def.type, item))
      : coerceScalar(def.type, value);
  }

  return out;
}

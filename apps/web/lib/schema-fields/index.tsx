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
    const rules = def.required ? [{ required: true, message: `${name} is required` }] : undefined;

    // Tag-mode Select handles free-form string and number arrays in one
    // control. `boolean[]` and `date[]` have no sensible tag input, so they get
    // a repeatable list of the scalar control instead.
    if (def.type === 'string[]' || def.type === 'number[]') {
      return (
        <Form.Item key={name} name={nameOf(name)} label={name} rules={rules}>
          <Select mode="tags" tokenSeparators={[',']} open={false} />
        </Form.Item>
      );
    }

    if (isArrayType(def.type)) {
      return (
        <Form.Item key={name} label={name} required={def.required}>
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
                <Button onClick={() => add()}>Add {name}</Button>
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
        label={name}
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
        label={name}
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
    label: name,
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

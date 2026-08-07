import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import dayjs from 'dayjs';
import type { FieldDefinition } from '@marketplace/contracts';
import { toFormItems, toFilterItems, toDescriptionRows, toAttributes } from './index';

const field = (over: Partial<FieldDefinition>): FieldDefinition => ({
  type: 'string',
  required: false,
  default: null,
  ...over,
});

const fields: Record<string, FieldDefinition> = {
  colour: field({ type: 'string', required: true }),
  weight: field({ type: 'number' }),
  fragile: field({ type: 'boolean' }),
  releasedOn: field({ type: 'date' }),
  tags: field({ type: 'string[]' }),
};

describe('toAttributes', () => {
  it('converts a Dayjs date into an ISO string', () => {
    const out = toAttributes(fields, { releasedOn: dayjs('2026-08-07T00:00:00.000Z') });
    expect(out.releasedOn).toBe('2026-08-07T00:00:00.000Z');
  });

  it('coerces tag-mode strings into numbers for number[] fields', () => {
    const out = toAttributes({ sizes: field({ type: 'number[]' }) }, { sizes: ['1', '2.5'] });
    expect(out.sizes).toEqual([1, 2.5]);
  });

  it('coerces a single number field from a string', () => {
    expect(toAttributes(fields, { weight: '12' }).weight).toBe(12);
  });

  it('drops keys that are absent rather than sending nulls', () => {
    expect(toAttributes(fields, { colour: 'red' })).toEqual({ colour: 'red' });
  });

  it('ignores values for names not in the schema', () => {
    expect(toAttributes(fields, { colour: 'red', bogus: 'x' })).toEqual({ colour: 'red' });
  });

  it('converts an array of Dayjs values for a date[] field', () => {
    const out = toAttributes(
      { window: field({ type: 'date[]' }) },
      { window: [dayjs('2026-01-01T00:00:00.000Z')] },
    );
    expect(out.window).toEqual(['2026-01-01T00:00:00.000Z']);
  });

  it('keeps a false boolean, which is a value and not an absence', () => {
    expect(toAttributes(fields, { fragile: false })).toEqual({ fragile: false });
  });

  it('keeps a zero, which is likewise a value', () => {
    expect(toAttributes(fields, { weight: 0 })).toEqual({ weight: 0 });
  });
});

describe('toFilterItems', () => {
  it('emits controls only for scalar equality-filterable types', () => {
    render(<Form>{toFilterItems(fields)}</Form>);
    expect(screen.getByLabelText('colour')).toBeInTheDocument();
    expect(screen.getByLabelText('weight')).toBeInTheDocument();
    expect(screen.getByLabelText('fragile')).toBeInTheDocument();
    // SearchProductsSchema types `attributes` as string | number | boolean:
    // arrays cannot be matched at all, and exact-match on a timestamp is
    // useless, so neither gets a control.
    expect(screen.queryByLabelText('tags')).toBeNull();
    expect(screen.queryByLabelText('releasedOn')).toBeNull();
  });
});

describe('toFormItems', () => {
  it('renders one labelled control per field', () => {
    render(<Form>{toFormItems(fields)}</Form>);
    for (const name of Object.keys(fields)) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it('marks a required field as required', () => {
    render(<Form>{toFormItems({ colour: field({ required: true }) })}</Form>);
    expect(screen.getByLabelText('colour')).toBeRequired();
  });
});

describe('toDescriptionRows', () => {
  it('renders a row per field and shows an em dash for a missing value', () => {
    const rows = toDescriptionRows(fields, { colour: 'red' });
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.key === 'colour')!.children).toBe('red');
    expect(rows.find((r) => r.key === 'weight')!.children).toBe('—');
  });

  it('joins array values with commas', () => {
    const rows = toDescriptionRows(fields, { tags: ['a', 'b'] });
    expect(rows.find((r) => r.key === 'tags')!.children).toBe('a, b');
  });

  it('renders booleans as yes and no rather than true and false', () => {
    const rows = toDescriptionRows(fields, { fragile: false });
    expect(rows.find((r) => r.key === 'fragile')!.children).toBe('no');
  });
});

import { FieldDefinition, FieldType } from '@marketplace/contracts';

export interface FieldError {
  field: string;
  code: 'unknown_field' | 'required' | 'invalid_type';
  message: string;
}

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: FieldError[] };

function matchesScalar(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value);
    default:
      return false;
  }
}

function matchesType(type: FieldType, value: unknown): boolean {
  if (type.endsWith('[]')) {
    const element = type.slice(0, -2);
    return Array.isArray(value) && value.every((v) => matchesScalar(element, v));
  }
  return matchesScalar(type, value);
}

export function validateAttributes(
  fields: Record<string, FieldDefinition>,
  input: Record<string, unknown>,
): ValidationResult {
  const errors: FieldError[] = [];
  const value: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    if (!(key in fields)) {
      errors.push({ field: key, code: 'unknown_field', message: `${key} is not defined for this tenant` });
    }
  }

  for (const [name, definition] of Object.entries(fields)) {
    const provided = input[name];
    const absent = provided === undefined || provided === null;

    if (absent) {
      if (definition.required) {
        errors.push({ field: name, code: 'required', message: `${name} is required` });
      } else if (definition.default !== null && definition.default !== undefined) {
        value[name] = definition.default;
      }
      continue;
    }

    if (!matchesType(definition.type, provided)) {
      errors.push({ field: name, code: 'invalid_type', message: `${name} must be of type ${definition.type}` });
      continue;
    }

    value[name] = provided;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

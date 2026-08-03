import { CreateProductSchema, SearchProductsSchema, FieldDefinitionSchema } from '@marketplace/contracts';
import { toOpenApi } from './zod-openapi';

describe('toOpenApi', () => {
  describe('CreateProductSchema', () => {
    const result = toOpenApi(CreateProductSchema) as Record<string, any>;

    it('renders a strict object as a closed schema', () => {
      expect(result.type).toBe('object');
      expect(result.additionalProperties).toBe(false);
    });

    it('requires only the fields with no default', () => {
      expect(result.required).toEqual(
        expect.arrayContaining(['name', 'description', 'priceMinor', 'currency', 'category', 'stock']),
      );
      // Asserted one at a time on purpose: `not.toEqual(arrayContaining([a, b, c]))`
      // only fails when ALL of a, b and c are present, so a single defaulted field
      // leaking into `required` would slip past it.
      expect(result.required).not.toContain('images');
      expect(result.required).not.toContain('status');
      expect(result.required).not.toContain('attributes');
    });

    it('renders the .url() array as a string array with a uri format', () => {
      expect(result.properties.images).toMatchObject({
        type: 'array',
        items: { type: 'string', format: 'uri' },
      });
    });

    it('renders the nested enum values', () => {
      expect(result.properties.status.enum).toEqual(['active', 'draft', 'archived', 'out_of_stock']);
    });
  });

  describe('SearchProductsSchema', () => {
    const result = toOpenApi(SearchProductsSchema) as Record<string, any>;

    it('renders the nullable cursor field', () => {
      expect(result.properties.cursor.nullable).toBe(true);
    });

    it('renders the record-of-union attributes field', () => {
      expect(result.properties.attributes.type).toBe('object');
      expect(result.properties.attributes.additionalProperties.anyOf).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'string' }),
          expect.objectContaining({ type: 'number' }),
          expect.objectContaining({ type: 'boolean' }),
        ]),
      );
    });
  });

  describe('FieldDefinitionSchema', () => {
    const result = toOpenApi(FieldDefinitionSchema) as Record<string, any>;

    it('renders every declared field type as an enum value', () => {
      expect(result.properties.type.enum).toEqual([
        'string', 'number', 'boolean', 'date', 'string[]', 'number[]', 'boolean[]', 'date[]',
      ]);
    });

    it('carries the default for a defaulted boolean field', () => {
      expect(result.properties.required.default).toBe(false);
    });

    it('carries the nullable default value field', () => {
      expect(result.properties.default.nullable).toBe(true);
      expect(result.properties.default.default).toBe(null);
    });
  });
});

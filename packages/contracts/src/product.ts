import { z } from 'zod';
import { AttributesSchema, CurrencySchema, MinorAmountSchema, StockSchema } from './common';

export const ProductStatusSchema = z.enum(['active', 'draft', 'archived', 'out_of_stock']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const CreateProductSchema = z
  .object({
    // Trimmed before the length check, so `min(1)` means "has a name" rather
    // than "has a character". A name of nothing but spaces used to satisfy it
    // and reach the storefront as a card with no title on it.
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    priceMinor: MinorAmountSchema,
    currency: CurrencySchema,
    category: z.string().trim().min(1).max(100),
    stock: StockSchema,
    images: z.array(z.string().url()).max(20).default([]),
    status: ProductStatusSchema.default('draft'),
    attributes: AttributesSchema.default({}),
  })
  .strict();
export type CreateProduct = z.infer<typeof CreateProductSchema>;

/**
 * A partial change to a product.
 *
 * Every field is optional and every bound is the one creation applies -- a
 * price that could not be created must not be reachable by editing either.
 * `id`, `entityType` and the audit stamps are absent rather than optional:
 * they belong to the engine, and `.strict()` turns an attempt to set one into
 * a 400 that names it instead of a silent no-op.
 *
 * An empty patch is refused. It is almost always a caller bug -- a mistyped
 * field name, or a form that submitted nothing -- and answering 200 hides it.
 */
export const UpdateProductSchema = CreateProductSchema
  .omit({ images: true, status: true, attributes: true })
  .extend({
    images: z.array(z.string().url()).max(20),
    status: ProductStatusSchema,
    attributes: AttributesSchema,
  })
  .partial()
  .strict()
  .refine((patch: Record<string, unknown>) => Object.keys(patch).length > 0, {
    message: 'a patch must change at least one field',
  });
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;

/**
 * The one lowercased blob free-text search matches against. Written onto the
 * stored record at create/update time -- DynamoDB `contains` is
 * case-sensitive, so the normalisation has to happen at write time, not query
 * time. Products written before this field existed simply do not match text
 * search until their next edit; local seeds are recreated every boot.
 */
export const productSearchBlob = (p: {
  name: string;
  description: string;
  category: string;
}): string => `${p.name} ${p.description} ${p.category}`.toLowerCase();

export const SearchProductsSchema = z
  .object({
    /** Free text, matched case-insensitively against name, description and category. */
    text: z.string().trim().min(1).max(200).optional(),
    category: z.string().optional(),
    status: ProductStatusSchema.optional(),
    priceMinorMin: MinorAmountSchema.optional(),
    priceMinorMax: MinorAmountSchema.optional(),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().nullable().default(null),
  })
  .strict();
export type SearchProducts = z.infer<typeof SearchProductsSchema>;

export interface ProductRecord {
  PK: string;
  SK: string;
  entityType: 'Product';
  id: string;
  status: ProductStatus;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  category: string;
  stock: number;
  images: string[];
  createdAt: string;
  updatedAt: string;
  attributes: Record<string, unknown>;
  /** Persistence-only: the lowercased text-search blob. Never on the wire. */
  search?: string;
}

import { z } from 'zod';
import { AttributesSchema, CurrencySchema, MinorAmountSchema, StockSchema } from './common';

export const ProductStatusSchema = z.enum(['active', 'draft', 'archived', 'out_of_stock']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const CreateProductSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(5000),
    priceMinor: MinorAmountSchema,
    currency: CurrencySchema,
    category: z.string().min(1).max(100),
    stock: StockSchema,
    images: z.array(z.string().url()).max(20).default([]),
    status: ProductStatusSchema.default('draft'),
    attributes: AttributesSchema.default({}),
  })
  .strict();
export type CreateProduct = z.infer<typeof CreateProductSchema>;

export const SearchProductsSchema = z
  .object({
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
}

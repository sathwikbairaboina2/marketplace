import { z } from 'zod';
import { CreateProductSchema } from './product';

/**
 * The seller's dashboard numbers, aggregated on read. Local-milestone shape:
 * no precomputed aggregates, no time windows -- the whole shop, now.
 */
export const SalesStatsSchema = z.object({
  orders: z.object({
    total: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    awaitingPayment: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
  /**
   * Revenue is kept per currency rather than summed across them -- adding
   * yen to euros produces a number that means nothing. Confirmed orders
   * only: an awaiting order has reserved stock but moved no money, and a
   * cancelled one moved it back.
   */
  revenueMinorByCurrency: z.record(z.string(), z.number().int().nonnegative()),
  topProducts: z
    .array(
      z.object({
        productId: z.string(),
        name: z.string(),
        units: z.number().int().nonnegative(),
        revenueMinor: z.number().int().nonnegative(),
        currency: z.string(),
      }),
    )
    .max(5),
  lowStock: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        stock: z.number().int().nonnegative(),
      }),
    )
    .max(20),
  /** True when a page budget stopped the scan early: the numbers are a floor. */
  truncated: z.boolean(),
});
export type SalesStats = z.infer<typeof SalesStatsSchema>;

export const LOW_STOCK_THRESHOLD = 5;

export const MAX_BATCH_PRODUCTS = 25;

/** POST /products/batch: validate everything, then write everything. */
export const BatchCreateProductsSchema = z
  .object({
    items: z.array(CreateProductSchema).min(1).max(MAX_BATCH_PRODUCTS),
  })
  .strict();
export type BatchCreateProducts = z.infer<typeof BatchCreateProductsSchema>;

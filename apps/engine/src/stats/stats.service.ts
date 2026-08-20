import { Injectable } from '@nestjs/common';
import {
  LOW_STOCK_THRESHOLD,
  OrderRecord,
  ProductRecord,
  SalesStats,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';

/**
 * Aggregated on read, whole-shop, no time windows. The scan walks pages under
 * a hard budget -- the same reasoning as filtered product reads: enough for
 * any local catalogue, a stop before an unbounded partition walk. When the
 * budget trips, `truncated: true` tells the dashboard its numbers are a floor.
 */
const PAGE_SIZE = 100;
const PAGE_BUDGET = 10;

@Injectable()
export class StatsService {
  constructor(private readonly repo: DynamoRepository) {}

  private async scan<T>(prefix: string): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < PAGE_BUDGET; page++) {
      const result: { items: T[]; nextCursor: string | null } = await this.repo.queryPrefix<T>(
        prefix,
        { limit: PAGE_SIZE, cursor },
      );
      items.push(...result.items);
      cursor = result.nextCursor;
      if (cursor === null) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  async sales(): Promise<SalesStats> {
    // Gated in the service as well as by the route decorator: this crosses
    // every buyer's orders, so a non-HTTP caller must hit the same wall.
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, 'Only an admin can read shop statistics');
    }

    const [orders, products] = await Promise.all([
      this.scan<OrderRecord>(skPrefix('Order')),
      this.scan<ProductRecord>(skPrefix('Product')),
    ]);

    const counts = { total: 0, confirmed: 0, awaitingPayment: 0, cancelled: 0 };
    const revenueMinorByCurrency: Record<string, number> = {};
    const byProduct = new Map<string, { units: number; revenueMinor: number; currency: string }>();

    for (const order of orders.items) {
      counts.total++;
      if (order.status === 'confirmed') counts.confirmed++;
      else if (order.status === 'awaiting_payment') counts.awaitingPayment++;
      else if (order.status === 'cancelled') counts.cancelled++;

      if (order.status !== 'confirmed') continue;
      revenueMinorByCurrency[order.currency] =
        (revenueMinorByCurrency[order.currency] ?? 0) + order.totalAmountMinor;
      for (const item of order.items) {
        const entry = byProduct.get(item.productId) ?? {
          units: 0,
          revenueMinor: 0,
          currency: order.currency,
        };
        entry.units += item.quantity;
        entry.revenueMinor += item.unitPriceMinor * item.quantity;
        byProduct.set(item.productId, entry);
      }
    }

    const names = new Map(products.items.map((p) => [p.id, p.name]));
    const topProducts = [...byProduct.entries()]
      .sort((a, b) => b[1].units - a[1].units)
      .slice(0, 5)
      .map(([productId, entry]) => ({
        productId,
        name: names.get(productId) ?? '(no longer listed)',
        units: entry.units,
        revenueMinor: entry.revenueMinor,
        currency: entry.currency,
      }));

    const lowStock = products.items
      .filter((p) => p.status === 'active' && p.stock <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 20)
      .map((p) => ({ id: p.id, name: p.name, stock: p.stock }));

    return {
      orders: counts,
      revenueMinorByCurrency,
      topProducts,
      lowStock,
      truncated: orders.truncated || products.truncated,
    };
  }
}

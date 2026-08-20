import { Injectable } from '@nestjs/common';
import {
  CartLine,
  CartResponse,
  MAX_CART_LINES,
  ProductRecord,
  ResolvedCartLine,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { cartSk, entitySk } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';

interface CartItem {
  lines: CartLine[];
}

@Injectable()
export class CartService {
  constructor(private readonly repo: DynamoRepository) {}

  private sk(): string {
    return cartSk(currentPrincipal().userId);
  }

  /** The stored lines, unresolved. Checkout consumes these. */
  async rawLines(): Promise<CartLine[]> {
    const item = await this.repo.get<CartItem>(this.sk());
    return item?.lines ?? [];
  }

  async get(): Promise<CartResponse> {
    return this.resolve(await this.rawLines());
  }

  async putLine(productId: string, qty: number): Promise<CartResponse> {
    const lines = await this.rawLines();
    const rest = lines.filter((l) => l.productId !== productId);

    if (qty === 0) {
      await this.repo.put(this.sk(), { lines: rest });
      return this.resolve(rest);
    }

    // Adding or changing a line requires a live product; lines already in the
    // cart survive archival (they surface as unavailable on read instead).
    const product = await this.repo.get<ProductRecord>(entitySk('Product', productId));
    if (!product) throw new ProblemException('not-found', 404, 'Product not found');
    if (product.status !== 'active') {
      throw new ProblemException(
        'invalid-request',
        422,
        'Product not available',
        `product ${productId} is ${product.status}`,
        { productId },
      );
    }

    const next = [...rest, { productId, qty }];
    if (next.length > MAX_CART_LINES) {
      throw new ProblemException(
        'invalid-request',
        422,
        'Cart is full',
        `a cart holds at most ${MAX_CART_LINES} distinct products`,
        { max: MAX_CART_LINES },
      );
    }
    await this.repo.put(this.sk(), { lines: next });
    return this.resolve(next);
  }

  async clear(): Promise<CartResponse> {
    await this.repo.put(this.sk(), { lines: [] });
    return { lines: [], totalMinor: 0 };
  }

  private async resolve(lines: CartLine[]): Promise<CartResponse> {
    const resolved: ResolvedCartLine[] = await Promise.all(
      lines.map(async (line) => {
        const product = await this.repo.get<ProductRecord>(entitySk('Product', line.productId));
        if (!product || product.status !== 'active') {
          return {
            productId: line.productId,
            qty: line.qty,
            name: product?.name ?? '(no longer available)',
            unitPriceMinor: product?.priceMinor ?? 0,
            currency: product?.currency ?? 'USD',
            image: product?.images?.[0] ?? null,
            stock: 0,
            unavailable: true,
          };
        }
        return {
          productId: line.productId,
          qty: line.qty,
          name: product.name,
          unitPriceMinor: product.priceMinor,
          currency: product.currency,
          image: product.images?.[0] ?? null,
          stock: product.stock,
          unavailable: false,
        };
      }),
    );
    const totalMinor = resolved
      .filter((l) => !l.unavailable)
      .reduce((sum, l) => sum + l.unitPriceMinor * l.qty, 0);
    return { lines: resolved, totalMinor };
  }
}

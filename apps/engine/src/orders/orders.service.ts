import { Injectable } from '@nestjs/common';
import {
  CreateOrder,
  MAX_ORDER_LINE_ITEMS,
  OrderLineItem,
  OrderRecord,
  Page,
  ProductRecord,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, gsi1UserPk, gsi1UserSk, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { failedTransactionIndexes } from '../common/transaction-errors';

// The HTTP-facing shape of an order. `OrderRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes and the
// `GSI1PK`/`GSI1SK` attributes used to index orders by owning user. Those are a
// persistence-layer implementation detail and are deliberately not part of the public API
// surface: clients should never see, depend on, or be able to parse the internal key scheme.
export type OrderResponse = Omit<OrderRecord, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>;

function toResponse(record: OrderRecord): OrderResponse {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, ...rest } = record;
  return rest;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async create(input: CreateOrder): Promise<OrderResponse> {
    if (input.items.length > MAX_ORDER_LINE_ITEMS) {
      throw new ProblemException(
        'too-many-line-items',
        422,
        'Too many line items',
        `an order may contain at most ${MAX_ORDER_LINE_ITEMS} line items`,
        { max: MAX_ORDER_LINE_ITEMS, received: input.items.length },
      );
    }

    // Reject a repeated product before anything reaches DynamoDB: a transaction cannot contain
    // two operations against the same item, so a caller who orders the same product twice must
    // be told to combine the quantities rather than have the transaction blow up opaquely.
    const ids = input.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      throw new ProblemException(
        'invalid-request',
        422,
        'Duplicate product in order',
        'each product may appear at most once; combine the quantities instead',
      );
    }

    const attributes = await this.registry.validate('Order', input.attributes);

    const products = await Promise.all(
      ids.map(async (id) => {
        const product = await this.repo.get<ProductRecord>(entitySk('Product', id));
        if (!product) {
          throw new ProblemException('invalid-request', 422, 'Unknown product', `no product ${id}`, {
            productId: id,
          });
        }
        if (product.currency !== input.currency) {
          throw new ProblemException(
            'mixed-currency-order',
            422,
            'Mixed currency order',
            `product ${id} is priced in ${product.currency}, order is in ${input.currency}`,
            { productId: id, productCurrency: product.currency, orderCurrency: input.currency },
          );
        }
        return product;
      }),
    );

    // `unitPriceMinor` is copied from the product now, at write time, so a later price edit
    // never rewrites this historical order -- the transaction below additionally conditions
    // each stock decrement on the price being unchanged since this read.
    const lineItems: OrderLineItem[] = input.items.map((item, i) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceMinor: products[i].priceMinor,
    }));
    const totalAmountMinor = lineItems.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);

    const principal = currentPrincipal();
    const id = newId();
    const createdAt = new Date().toISOString();

    const record: OrderResponse = {
      entityType: 'Order',
      id,
      userId: principal.userId,
      status: 'confirmed',
      totalAmountMinor,
      currency: input.currency,
      items: lineItems,
      shippingAddress: input.shippingAddress,
      createdAt,
      attributes,
    };

    const fullRecord: OrderRecord = {
      ...record,
      ...this.repo.key(entitySk('Order', id)),
      GSI1PK: gsi1UserPk(principal.tenantId, principal.userId),
      GSI1SK: gsi1UserSk('Order', createdAt, id),
    };

    // Item i is the stock update for line item i; the order Put is last. `explainFailure`
    // below relies on this exact ordering to map a failed transaction index back to the
    // product that caused it -- do not reorder or interleave these without updating it too.
    const transactItems = [
      ...input.items.map((item, i) => ({
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Product', item.productId)),
          UpdateExpression: 'SET #stock = #stock - :qty, #updatedAt = :now',
          // Both conditions guard against a stale read: `#stock >= :qty` closes the
          // stock-race window (Invariant 3), and `#price = :expectedPrice` closes the
          // read-then-write window against a concurrent price edit so this order can never
          // silently charge a stale amount.
          ConditionExpression: '#stock >= :qty AND #price = :expectedPrice',
          ExpressionAttributeNames: {
            '#stock': 'stock',
            '#price': 'priceMinor',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':qty': item.quantity,
            ':expectedPrice': products[i].priceMinor,
            ':now': createdAt,
          },
        },
      })),
      {
        Put: {
          TableName: this.repo.tableName,
          Item: fullRecord,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ];

    try {
      await this.repo.transactWrite(transactItems);
    } catch (err) {
      await this.explainFailure(err, input, products);
      throw err;
    }

    return record;
  }

  /** Turns a cancelled transaction into the specific problem that caused it. */
  private async explainFailure(
    err: unknown,
    input: CreateOrder,
    products: ProductRecord[],
  ): Promise<never | void> {
    const failed = failedTransactionIndexes(err);
    const lineIndex = failed.find((i) => i < input.items.length);
    if (lineIndex === undefined) return;

    const item = input.items[lineIndex];
    const expected = products[lineIndex];
    const current = await this.repo.get<ProductRecord>(entitySk('Product', item.productId));

    // The transaction's ConditionExpression combines the stock and price checks with AND, so a
    // cancellation alone doesn't say which one failed. Re-read the product to distinguish them:
    // a price mismatch is reported as `price-changed`, everything else as `insufficient-stock`.
    if (current && current.priceMinor !== expected.priceMinor) {
      throw new ProblemException(
        'price-changed',
        409,
        'Product price changed',
        `product ${item.productId} is now priced at ${current.priceMinor}`,
        {
          productId: item.productId,
          expectedPriceMinor: expected.priceMinor,
          currentPriceMinor: current.priceMinor,
        },
      );
    }

    throw new ProblemException(
      'insufficient-stock',
      409,
      'Insufficient stock',
      `product ${item.productId} has ${current?.stock ?? 0} in stock, ${item.quantity} requested`,
      { productId: item.productId, available: current?.stock ?? 0, requested: item.quantity },
    );
  }

  async get(id: string): Promise<OrderResponse> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!found) throw new ProblemException('not-found', 404, 'Order not found');
    return toResponse(found);
  }

  async listForCurrentUser(limit: number, cursor: string | null): Promise<Page<OrderResponse>> {
    const page = await this.repo.queryUserIndex<OrderRecord>(
      currentPrincipal().userId,
      skPrefix('Order'),
      { limit, cursor },
    );
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }
}

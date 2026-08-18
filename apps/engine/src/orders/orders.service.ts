import { Injectable } from '@nestjs/common';
import {
  CreateOrder,
  DEFAULT_PIPELINE,
  MAX_ORDER_LINE_ITEMS,
  OrderLineItem,
  OrderRecord,
  OrderResponse,
  Page,
  ProductRecord,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, gsi1UserPk, gsi1UserSk, PIPELINE_SK, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { conflictedTransactionIndexes, failedTransactionIndexes } from '../common/transaction-errors';
import { PipelineService } from '../pipeline/pipeline.service';

// The HTTP-facing shape of an order. `OrderRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes and the
// `GSI1PK`/`GSI1SK` attributes used to index orders by owning user. Those are a
// persistence-layer implementation detail and are deliberately not part of the public API
// surface: clients should never see, depend on, or be able to parse the internal key scheme.
//
// Defined as `z.infer<typeof OrderResponseSchema>` in @marketplace/contracts rather than as an
// `Omit<OrderRecord, ...>` here, so the browser client has a runtime schema to validate against
// and cannot drift from the type this service returns.
export type { OrderResponse };

function toResponse(record: OrderRecord): OrderResponse {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, ...rest } = record;
  // Orders written before stages existed carry none of these attributes. They are
  // filled here rather than backfilled into the table, so the response schema can
  // require them without a migration and without a dual-shape type: an old order
  // reads as a one-stage shop, which is exactly what it was.
  return {
    ...rest,
    pipelineVersion: rest.pipelineVersion ?? DEFAULT_PIPELINE.version,
    stages: rest.stages ?? DEFAULT_PIPELINE.stages,
    currentStageId: rest.currentStageId ?? DEFAULT_PIPELINE.stages[0].id,
    stageEnteredAt: rest.stageEnteredAt ?? rest.createdAt,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
    private readonly pipeline: PipelineService,
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

    // Copied onto the order below, at write time, exactly as `unitPriceMinor` is:
    // a later rename or reorder by the owner publishes a new pipeline version and
    // must never rewrite the lifecycle an order already in flight is walking.
    const pipeline = await this.pipeline.get();

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
    // Belt-and-braces: `MinorAmountSchema`/`QuantitySchema` bound `unitPriceMinor` and `quantity`
    // so that MAX_ORDER_LINE_ITEMS line items at the maximum of both can never leave exact-integer
    // range (see the arithmetic in `packages/contracts/src/common.ts`), but this arithmetic is
    // still IEEE-754 addition/multiplication in JavaScript, not integer arithmetic -- if those
    // bounds are ever loosened without re-checking this invariant, silently storing a drifted
    // total would be exactly the "no floats" guarantee this project exists to uphold. Raise a
    // problem instead.
    if (!Number.isSafeInteger(totalAmountMinor)) {
      throw new ProblemException(
        'internal-error',
        500,
        'Order total lost precision',
        'the computed order total left Number.MAX_SAFE_INTEGER range',
        { totalAmountMinor },
      );
    }

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
      pipelineVersion: pipeline.version,
      stages: pipeline.stages,
      currentStageId: pipeline.stages[0].id,
      stageEnteredAt: createdAt,
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
      {
        // The pipeline was read a moment ago and nothing else pins it. If the
        // owner saves a new one between that read and this commit, the order
        // would be stamped with a lifecycle already superseded; fail the whole
        // transaction instead and let the buyer retry against the new pipeline.
        //
        // Deliberately last: `explainFailure` maps a failed index 0..n-1 back to
        // a line item, so nothing may be inserted ahead of the stock updates.
        ConditionCheck: {
          TableName: this.repo.tableName,
          Key: this.repo.key(PIPELINE_SK),
          ...(pipeline.version === 0
            ? { ConditionExpression: 'attribute_not_exists(#version)' }
            : {
                ConditionExpression: '#version = :expectedVersion',
                ExpressionAttributeValues: { ':expectedVersion': pipeline.version },
              }),
          ExpressionAttributeNames: { '#version': 'version' },
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
    // A failed ConditionExpression (stock/price) takes priority over a bare contention signal:
    // if we can tell the caller exactly what changed, that is strictly more useful than "retry".
    const failedIndex = failedTransactionIndexes(err).find((i) => i < input.items.length);
    if (failedIndex !== undefined) {
      const item = input.items[failedIndex];
      const expected = products[failedIndex];
      const current = await this.repo.get<ProductRecord>(entitySk('Product', item.productId));

      // The product that failed its condition may have been deleted entirely between our read
      // and the transaction's write -- that is a categorically different problem from "out of
      // stock" (current?.stock ?? 0 would otherwise silently report 0 in stock, misleading the
      // customer into thinking the product still exists but is sold out).
      if (current === null) {
        throw new ProblemException(
          'not-found',
          404,
          'Product no longer exists',
          `product ${item.productId} was removed before the order could be completed`,
          { productId: item.productId },
        );
      }

      // The transaction's ConditionExpression combines the stock and price checks with AND, so
      // a cancellation alone doesn't say which one failed. Re-read the product to distinguish
      // them: a price mismatch is reported as `price-changed`, everything else as
      // `insufficient-stock`.
      if (current.priceMinor !== expected.priceMinor) {
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
        `product ${item.productId} has ${current.stock} in stock, ${item.quantity} requested`,
        { productId: item.productId, available: current.stock, requested: item.quantity },
      );
    }

    // No ConditionExpression failed, but the transaction was still cancelled: on a real table,
    // concurrent transactions racing on the same item routinely produce `TransactionConflict`
    // instead of `ConditionalCheckFailed`. DynamoDB Local's concurrency model tends to surface
    // only the latter, so this branch is easy to leave untested locally -- without it, this
    // falls through, the raw AWS error propagates, and ProblemFilter maps it to an unhelpful
    // 500 for what is actually a routine, retryable race.
    const conflictIndex = conflictedTransactionIndexes(err).find((i) => i < input.items.length);
    if (conflictIndex !== undefined) {
      const item = input.items[conflictIndex];
      throw new ProblemException(
        'transaction-conflict',
        409,
        'Concurrent write conflict',
        `product ${item.productId} was updated by another request at the same moment; retry`,
        { productId: item.productId },
      );
    }
  }

  /**
   * Moves an order to the next stage of the snapshot it was placed under. Admin
   * only: advancing is the seller's account of what they have physically done.
   */
  async advance(id: string, expectedStageId: string): Promise<OrderResponse> {
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, 'Only an admin can advance an order');
    }

    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!found) throw new ProblemException('not-found', 404, 'Order not found');
    const current = toResponse(found);

    if (current.status !== 'confirmed') {
      throw new ProblemException(
        'order-not-advanceable',
        409,
        'Order is not advanceable',
        `order ${id} is ${current.status}`,
      );
    }

    const index = current.stages.findIndex((stage) => stage.id === current.currentStageId);
    const next = current.stages[index + 1];
    if (!next) {
      // A shop that has never configured a pipeline has exactly one stage, which
      // is therefore also its last: there is nowhere to advance to, and that is
      // correct rather than a defect. The cockpit renders no button at all here,
      // so a seller should never meet this as an error.
      throw new ProblemException(
        'order-at-final-stage',
        409,
        'Order is at its final stage',
        `${current.stages[index]?.name ?? 'this stage'} is the last stage this order was placed under`,
        { stageId: current.currentStageId },
      );
    }

    const now = new Date().toISOString();
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Order', id)),
            UpdateExpression: 'SET #currentStageId = :next, #stageEnteredAt = :now',
            // Conditioned rather than read-then-written, so two sellers clicking
            // at the same moment cannot skip a stage between them -- the same
            // reasoning as `#stock >= :qty` in `create`.
            ConditionExpression: '#currentStageId = :expected AND #status = :confirmed',
            ExpressionAttributeNames: {
              '#currentStageId': 'currentStageId',
              '#stageEnteredAt': 'stageEnteredAt',
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':next': next.id,
              ':now': now,
              ':expected': expectedStageId,
              ':confirmed': 'confirmed',
            },
          },
        },
      ]);
    } catch (err) {
      if (failedTransactionIndexes(err).includes(0)) {
        throw new ProblemException(
          'stage-moved',
          409,
          'Order stage moved',
          'this order left that stage before your change was applied; reload it',
          { expectedStageId },
        );
      }
      throw err;
    }

    return { ...current, currentStageId: next.id, stageEnteredAt: now };
  }

  async get(id: string): Promise<OrderResponse> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    // Cross-tenant access already 404s because `repo.get` is scoped to the current tenant's
    // partition -- a lookup from another tenant simply finds nothing. Ownership within the same
    // tenant is a separate check: `listForCurrentUser` is scoped to the caller's own orders via
    // the GSI1 user index, and `get` must agree with it, or any authenticated user of a tenant
    // could read any other user's order (shipping address, totals, line items) just by knowing
    // its id. Reported as 404, not 403 -- per the project-wide rule that a 403 would itself leak
    // that the order exists, just to someone who isn't allowed to see it.
    if (!found || found.userId !== currentPrincipal().userId) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
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

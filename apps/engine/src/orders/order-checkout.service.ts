import { Injectable } from '@nestjs/common';
import {
  CreateOrder,
  depositSplit,
  normalizeEmailHandle,
  normalizePhoneHandle,
  MAX_ORDER_LINE_ITEMS,
  OrderLineItem,
  OrderRecord,
  OrderResponse,
  orderReferenceFrom,
  ProductRecord,
} from '@marketplace/contracts';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { SettingsService } from '../settings/settings.service';
import { DynamoRepository } from '../persistence/dynamo.repository';
import {
  customerOrderSk,
  entitySk,
  gsi1UserPk,
  gsi1UserSk,
  orderRefSk,
  PIPELINE_SK,
} from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { deriveIdFrom, newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { conflictedTransactionIndexes, failedTransactionIndexes } from '../common/transaction-errors';

/**
 * Placing an order: the validation, the price snapshot and the one transaction
 * that takes stock, writes the order and pins the pipeline version. Split out
 * of OrdersService by concern; the transaction's index-to-line-item mapping in
 * `explainFailure` is the reason nothing may be inserted ahead of the stock
 * updates, and that invariant now has a file of its own.
 */
@Injectable()
export class OrderCheckoutService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
    private readonly pipeline: PipelineService,
    private readonly settings: SettingsService,
  ) {}

  async create(
    input: CreateOrder,
    opts: { awaitPayment?: boolean; guestEmail?: string } = {},
  ): Promise<OrderResponse> {
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

    // A deposit is a price, not a payment state: the buyer pays part now and
    // the rest in the room, and the order's `status` never learns about it.
    // The shop's policy decides whether one is on offer and how much -- asking
    // the client for the amount would let it name its own.
    // Who this is, as far as a shop with no accounts can tell: the number and
    // the address they gave. Hashed, never stored in the key -- `encodeCursor`
    // hands a sort key to the browser as a paging cursor.
    const customerHandles = [
      opts.guestEmail ? normalizeEmailHandle(opts.guestEmail) : null,
      input.shippingAddress.phone ? normalizePhoneHandle(input.shippingAddress.phone) : null,
    ]
      .filter((handle): handle is string => Boolean(handle))
      .map((handle) => deriveIdFrom(handle));

    const balance = input.deposit
      ? depositSplit(totalAmountMinor, await this.settings.getDepositPolicy()).balanceDueMinor
      : 0;

    const record: OrderResponse = {
      entityType: 'Order',
      id,
      reference: orderReferenceFrom(id),
      userId: principal.userId,
      status: opts.awaitPayment ? 'awaiting_payment' : 'confirmed',
      totalAmountMinor,
      currency: input.currency,
      items: lineItems,
      shippingAddress: input.shippingAddress,
      fulfilment: input.fulfilment,
      // What the buyer still owes. The engine works the split out from the
      // shop's own policy -- the client asks for a deposit, it never names an
      // amount.
      balanceDueMinor: balance,
      createdAt,
      attributes,
      pipelineVersion: pipeline.version,
      stages: pipeline.stages,
      // The payment gate sits before the copied stage list: an unpaid order
      // points at no stage until `pay` moves it into the first one.
      currentStageId: opts.awaitPayment ? null : pipeline.stages[0].id,
      stageEnteredAt: createdAt,
      // Only on a guest's order. Spread conditionally so a signed-in buyer's
      // record carries no `guestEmail: undefined` for DynamoDB to refuse.
      ...(opts.guestEmail ? { guestEmail: opts.guestEmail } : {}),
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
      {
        // The printed reference, pointed at the real id so `lookup` can resolve
        // what a shopper reads off their confirmation. Also last, and for the
        // same reason: `explainFailure` maps a failed index back to a line item
        // by position, so nothing may go ahead of the stock updates.
        //
        // BEFORE YOU APPEND ANOTHER ITEM HERE: `explainFailure` filters
        // `i < input.items.length`, so a *condition failure on an appended
        // item is invisible to it* and reaches the problem filter as a 500.
        // This Put is conditioned and safe only because a ULID's random tail
        // does not repeat. An appended item whose key can legitimately already
        // exist -- a per-customer pointer, say -- must be an unconditioned Put
        // or an Update, or every returning customer's second order 500s.
        //
        // In the transaction rather than after it, so an order can never exist
        // with a reference printed on it that nothing can resolve. Conditioned
        // on the reference being free: on the vanishing chance of a collision
        // the whole checkout fails and the retry mints a new id.
        Put: {
          TableName: this.repo.tableName,
          Item: {
            ...this.repo.key(orderRefSk(record.reference)),
            entityType: 'OrderRef',
            orderId: id,
            createdAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      // How a returning customer finds what they bought last time. One pointer
      // per way we know them -- the phone number this merchant actually looks
      // people up by, and the email a guest checked out with.
      //
      // Unconditioned Puts, and that is not an oversight: a condition failure
      // on an appended item is invisible to `explainFailure` and would surface
      // as a 500, and these keys legitimately already exist for anybody buying
      // a second time. An overwrite is the correct outcome anyway -- the key
      // carries the order id, so the same order writes the same row.
      ...customerHandles.map((handleHash) => ({
        Put: {
          TableName: this.repo.tableName,
          Item: {
            ...this.repo.key(customerOrderSk(handleHash, createdAt, id)),
            entityType: 'CustomerOrder',
            orderId: id,
            createdAt,
          },
        },
      })),
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
          `one of the items in your basket was removed before the order could be completed`,
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
          `${current.name} is now priced at ${current.priceMinor}`,
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
        // The shopper reads this one. A ULID tells them nothing about which of
        // the things in their basket went out of stock.
        current.stock === 0
          ? `${current.name} sold out while it was in your basket`
          : `only ${current.stock} of ${current.name} left, ${item.quantity} requested`,
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
}

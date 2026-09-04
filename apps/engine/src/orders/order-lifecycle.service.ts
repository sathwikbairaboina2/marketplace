import { Injectable } from '@nestjs/common';
import {
  OrderRecord,
  OrderResponse,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { entitySk } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { conflictedTransactionIndexes, failedTransactionIndexes } from '../common/transaction-errors';
import { assertAdmin } from '../common/roles';
import { mayActOn, toResponse } from './order-response';

/**
 * What happens to a confirmed order after it is placed: the seller advancing
 * it through the stages it was placed under, and the buyer withdrawing it
 * while the shop still allows that -- with the stock coming back in the mirror
 * image of checkout's transaction.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(private readonly repo: DynamoRepository) {}

  /**
   * Moves an order to the next stage of the snapshot it was placed under. Admin
   * only: advancing is the seller's account of what they have physically done.
   */
  async advance(id: string, expectedStageId: string): Promise<OrderResponse> {
    assertAdmin('advance an order');

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
    if (index === -1) {
      // The order points at a stage its own snapshot does not contain. Nothing
      // in this service can produce that -- `create` takes the first stage of
      // the snapshot it just wrote and `advance` only ever moves to another
      // member of it -- but `stages[-1 + 1]` is `stages[0]`, so without this an
      // order in that state would silently "advance" back to its first stage.
      // The tracker deliberately falls back to the first stage for *rendering*;
      // a state transition is not allowed the same guess.
      throw new ProblemException(
        'order-not-advanceable',
        409,
        'Order is not advanceable',
        `order ${id} is in a stage that is not part of the stages it was placed under`,
        { stageId: current.currentStageId },
      );
    }
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

  /**
   * The buyer's own withdrawal, permitted only while the stage the order sits in
   * was marked cancellable by the shop that defined it. Restores the stock the
   * order took, in the mirror image of `create`'s transaction.
   */
  async cancel(id: string, opts: { guestEmail?: string } = {}): Promise<OrderResponse> {
    // Ownership is checked exactly as `get` does, and reported the same way: a
    // 403 here would confirm the order exists to somebody not allowed to see it.
    // Two widenings: a tenant admin may cancel an order stuck in the payment
    // gate -- clearing stale unpaid orders is the seller's stock coming back --
    // and a guest may cancel with the email they checked out under, so the
    // stock does not sit reserved behind a ticket their browser has lost.
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    const principal = currentPrincipal();
    const adminMayCancel = found?.status === 'awaiting_payment';
    if (!mayActOn(found, principal, { admin: adminMayCancel, guestEmail: opts.guestEmail })) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    const current = toResponse(found);

    // An order in the payment gate is always cancellable: no money has moved,
    // no stage has begun, and holding the stock helps nobody.
    const awaiting = current.status === 'awaiting_payment';
    const stage = current.stages.find((s) => s.id === current.currentStageId);
    if (!awaiting && (current.status !== 'confirmed' || !stage?.cancellable)) {
      throw new ProblemException(
        'order-not-cancellable',
        409,
        'Order cannot be cancelled',
        current.status !== 'confirmed'
          ? `order ${id} is already ${current.status}`
          : `this shop does not allow cancelling at ${stage?.name ?? 'this stage'}`,
        { stageId: current.currentStageId },
      );
    }

    // Item i restores the stock for line item i; the order Update is last. The
    // same ordering `create` uses, and `explainCancelFailure` depends on it.
    const transactItems = [
      ...current.items.map((item) => ({
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Product', item.productId)),
          UpdateExpression: 'SET #stock = #stock + :qty',
          // No price condition on the way back: `create` conditions on price
          // because it is charging money, and returning stock does not care what
          // the product costs now. No upper-bound check either -- StockSchema's
          // cap is an input bound, and conditioning on it would fail a buyer's
          // cancel for a reason they cannot fix.
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#stock': 'stock' },
          ExpressionAttributeValues: { ':qty': item.quantity },
        },
      })),
      {
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Order', id)),
          UpdateExpression: 'SET #status = :cancelled',
          // The status condition is what makes a double cancel impossible and the
          // stock restore exactly-once. The stage condition is what stops a buyer
          // cancelling goods the seller dispatched in the gap between their page
          // rendering and their click. An awaiting_payment order has no stage, so
          // its condition is status alone -- conditioned on the status actually
          // observed, not a hard-coded 'confirmed'.
          ConditionExpression: awaiting
            ? '#status = :expected'
            : '#status = :expected AND #currentStageId = :stage',
          ExpressionAttributeNames: (awaiting
            ? { '#status': 'status' }
            : { '#status': 'status', '#currentStageId': 'currentStageId' }) as Record<
            string,
            string
          >,
          ExpressionAttributeValues: {
            ':cancelled': 'cancelled',
            ':expected': current.status,
            ...(awaiting ? {} : { ':stage': current.currentStageId }),
          },
        },
      },
    ];

    try {
      await this.repo.transactWrite(transactItems);
    } catch (err) {
      await this.explainCancelFailure(err, current);
      throw err;
    }

    // The order keeps its stage, so the tracker can say where it stopped rather
    // than only that it stopped.
    return { ...current, status: 'cancelled' };
  }

  /** Turns a cancelled cancellation into the specific problem that caused it. */
  private async explainCancelFailure(err: unknown, order: OrderResponse): Promise<never | void> {
    const failed = failedTransactionIndexes(err);

    const productIndex = failed.find((i) => i < order.items.length);
    if (productIndex !== undefined) {
      // There is no delete-product endpoint today, but `attribute_exists` and
      // this branch must agree on what "gone" means regardless -- without it the
      // raw AWS error would surface as an unhelpful 500.
      throw new ProblemException(
        'not-found',
        404,
        'Product no longer exists',
        `product ${order.items[productIndex].productId} was removed, so its stock cannot be restored`,
        { productId: order.items[productIndex].productId },
      );
    }

    if (failed.includes(order.items.length)) {
      // The order item's condition combines status and stage with AND, so a
      // cancellation alone does not say which failed. Re-read to tell them
      // apart: a stage that moved is recoverable by reloading, an order already
      // cancelled is not.
      const now = await this.repo.get<OrderRecord>(entitySk('Order', order.id));
      if (now && now.status === 'confirmed') {
        // A cancel racing from the payment gate loses to a concurrent pay, not
        // to a stage move -- say what actually happened.
        if (order.status === 'awaiting_payment') {
          throw new ProblemException(
            'order-not-cancellable',
            409,
            'Order cannot be cancelled',
            'this order was paid before your cancellation was applied; reload it',
          );
        }
        throw new ProblemException(
          'stage-moved',
          409,
          'Order stage moved',
          'this order moved to another stage before your cancellation was applied; reload it',
          { stageId: order.currentStageId },
        );
      }
      throw new ProblemException(
        'order-not-cancellable',
        409,
        'Order cannot be cancelled',
        `order ${order.id} is already cancelled`,
      );
    }

    const conflict = conflictedTransactionIndexes(err).find((i) => i <= order.items.length);
    if (conflict !== undefined) {
      throw new ProblemException(
        'transaction-conflict',
        409,
        'Concurrent write conflict',
        'this order was updated by another request at the same moment; retry',
      );
    }
  }
}

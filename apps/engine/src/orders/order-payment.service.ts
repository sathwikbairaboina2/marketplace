import { Inject, Injectable } from '@nestjs/common';
import {
  Card,
  OrderRecord,
  OrderResponse,
  Payment,
} from '@marketplace/contracts';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment.provider';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { entitySk } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { failedTransactionIndexes } from '../common/transaction-errors';
import { mayActOn, toResponse } from './order-response';

/** The payment gate: charging an awaiting_payment order into its first stage. */
@Injectable()
export class OrderPaymentService {
  constructor(
    private readonly repo: DynamoRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Takes payment for an order sitting in the awaiting_payment gate and moves
   * it into the first stage of the snapshot it was placed under. Buyer-owned,
   * same 404-not-403 shape as get/cancel -- and a guest may also prove it with
   * the email they checked out under, which is the only key to the order that
   * outlives their browser.
   */
  async pay(id: string, card: Card, opts: { guestEmail?: string } = {}): Promise<OrderResponse> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!mayActOn(found, currentPrincipal(), { guestEmail: opts.guestEmail })) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    const current = toResponse(found);

    if (current.status !== 'awaiting_payment') {
      throw new ProblemException(
        'order-not-payable',
        409,
        'Order is not awaiting payment',
        `order ${id} is ${current.status}`,
      );
    }

    // Amount comes from the order the transaction wrote -- never from the
    // client -- and it is what is payable *now*: an order taken on a deposit
    // charges the total less the balance the buyer settles in the room.
    const payableNow = current.totalAmountMinor - current.balanceDueMinor;
    const receipt = await this.provider.charge({
      orderId: id,
      amountMinor: payableNow,
      currency: current.currency,
      card,
    });

    const now = new Date().toISOString();
    const payment: Payment = {
      id: receipt.paymentId,
      last4: receipt.last4,
      amountMinor: payableNow,
      at: now,
    };
    const firstStageId = current.stages[0].id;

    // Charge-then-conditional-write is safe ONLY because the fake provider is
    // deterministic and offline: a lost race after a successful fake charge
    // costs nothing real. A real provider slotted in behind PAYMENT_PROVIDER
    // needs an idempotency key on the charge and a reconciliation story first.
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Order', id)),
            UpdateExpression:
              'SET #status = :confirmed, #currentStageId = :stage, #stageEnteredAt = :now, #payment = :payment',
            // The status condition is the double-pay and pay-after-cancel
            // guard: whichever write lands second fails its condition.
            ConditionExpression: '#status = :awaiting',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#currentStageId': 'currentStageId',
              '#stageEnteredAt': 'stageEnteredAt',
              '#payment': 'payment',
            },
            ExpressionAttributeValues: {
              ':confirmed': 'confirmed',
              ':stage': firstStageId,
              ':now': now,
              ':payment': payment,
              ':awaiting': 'awaiting_payment',
            },
          },
        },
      ]);
    } catch (err) {
      if (failedTransactionIndexes(err).includes(0)) {
        throw new ProblemException(
          'order-not-payable',
          409,
          'Order is not awaiting payment',
          'this order was paid or cancelled by another request; reload it',
        );
      }
      throw err;
    }

    return {
      ...current,
      status: 'confirmed',
      currentStageId: firstStageId,
      stageEnteredAt: now,
      payment,
    };
  }
}

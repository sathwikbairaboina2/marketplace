import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OrderRecord,
  OrderResponse,
  PaymentIntentResponse,
  StartPayment,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { entitySk, paymentEventSk, paymentIntentSk } from '../persistence/keys';
import { currentPrincipal, currentTenantId } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { mayActOn, toResponse } from '../orders/order-response';
import { PAYMENT_PROVIDER, PaymentEvent, PaymentProvider } from './payment.provider';
import { PaymentIntentRecord } from './payment-intent.record';

/**
 * A payment that happens somewhere else.
 *
 * The card path returns a result; this one cannot. The customer approves in
 * their own banking app, and what this service does is start the request,
 * record it, and react to the truth whenever it turns up — by webhook if the
 * gateway can reach us, by asking if it never does.
 *
 * Everything converges on one write. `confirm` is the only thing that moves an
 * order to confirmed, it is conditioned on the order not already being there,
 * and it is safe to run twice — because with an at-least-once gateway and a
 * poll that can race it, it will be.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: DynamoRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Begin collecting. Answers with somewhere to send the customer and an id to
   * ask about — never with a result, because there is not one yet.
   */
  async start(
    orderId: string,
    input: StartPayment,
    opts: { guestEmail?: string } = {},
  ): Promise<PaymentIntentResponse> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', orderId));
    if (!mayActOn(found, currentPrincipal(), { guestEmail: opts.guestEmail })) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    const order = toResponse(found);
    if (order.status !== 'awaiting_payment' && order.status !== 'payment_pending') {
      throw new ProblemException(
        'order-not-payable',
        409,
        'Order is not awaiting payment',
        `the order is ${order.status}`,
      );
    }

    // The amount is the order's, less anything being collected in the room.
    // Never the client's: it does not get to name what it is paying.
    const amountMinor = order.totalAmountMinor - order.balanceDueMinor;
    const intent = await this.provider.createIntent({
      orderId,
      tenantId: currentTenantId(),
      reference: order.reference,
      amountMinor,
      currency: order.currency,
      vpa: input.vpa,
    });

    const record: PaymentIntentRecord = {
      entityType: 'PaymentIntent',
      intentId: intent.intentId,
      orderId,
      tenantId: currentTenantId(),
      amountMinor,
      currency: order.currency,
      state: 'pending',
      createdAt: new Date().toISOString(),
    };
    await this.repo.put(paymentIntentSk(intent.intentId), { ...record });

    // The order says a payment is in flight, so a second tab cannot start
    // another one and the sweeper knows not to reclaim the stock yet.
    await this.markPending(order);

    return {
      intentId: intent.intentId,
      state: 'pending',
      amountMinor,
      currency: order.currency,
      approvalUrl: intent.approvalUrl,
    };
  }

  /** What the shopper's waiting page asks, and what the poll asks. */
  async status(intentId: string): Promise<PaymentIntentResponse> {
    const record = await this.repo.get<PaymentIntentRecord>(paymentIntentSk(intentId));
    if (!record) {
      throw new ProblemException('payment-intent-not-found', 404, 'No such payment');
    }

    // Pending *here* does not mean pending at the gateway: the webhook may
    // have been lost. Ask, and settle on the answer. This is the only thing
    // standing between a customer who has paid and an order that says nobody
    // has.
    if (record.state === 'pending') {
      const event = await this.provider.getIntent(intentId).catch(() => null);
      if (event && event.state !== 'pending') {
        await this.apply(event).catch((err: unknown) => {
          this.logger.warn(`reconciling ${intentId} failed: ${String(err)}`);
        });
        const fresh = await this.repo.get<PaymentIntentRecord>(paymentIntentSk(intentId));
        if (fresh) return this.asResponse(fresh);
      }
    }
    return this.asResponse(record);
  }

  /**
   * A verified event, applied once.
   *
   * Claimed by the gateway's own event id before anything is written, because
   * a gateway delivers at least once and a second delivery must be a no-op
   * rather than a second confirmation.
   */
  async apply(event: PaymentEvent): Promise<void> {
    const record = await this.repo.get<PaymentIntentRecord>(paymentIntentSk(event.intentId));
    if (!record) {
      throw new ProblemException('payment-intent-not-found', 404, 'No such payment');
    }

    // The order is the truth about how much is owed. A message that disagrees
    // is refused rather than reconciled.
    if (event.state === 'paid' && event.amountMinor !== record.amountMinor) {
      throw new ProblemException(
        'payment-amount-mismatch',
        409,
        'That payment is for a different amount',
        `this shop expects ${record.amountMinor} and the message says ${event.amountMinor}`,
      );
    }

    const claimed = await this.repo.putIfAbsent(paymentEventSk(event.eventId), {
      entityType: 'PaymentEvent',
      eventId: event.eventId,
      intentId: event.intentId,
      seenAt: new Date().toISOString(),
    });
    if (!claimed) return;

    await this.repo.put(paymentIntentSk(event.intentId), {
      ...record,
      state: event.state,
      settledAt: new Date().toISOString(),
    });

    if (event.state === 'paid') await this.confirm(record, event);
    else await this.release(record);
  }

  private asResponse(record: PaymentIntentRecord): PaymentIntentResponse {
    return {
      intentId: record.intentId,
      state: record.state,
      amountMinor: record.amountMinor,
      currency: record.currency,
    };
  }

  /** Order to `payment_pending`, conditioned on it still awaiting payment. */
  private async markPending(order: OrderResponse): Promise<void> {
    if (order.status === 'payment_pending') return;
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Order', order.id)),
            UpdateExpression: 'SET #status = :pending',
            ConditionExpression: '#status = :awaiting',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':pending': 'payment_pending',
              ':awaiting': 'awaiting_payment',
            },
          },
        },
      ]);
    } catch (err) {
      // Somebody else moved it first. The intent exists either way and the
      // webhook still settles it; losing this race is not a reason to refuse
      // a customer's payment.
      this.logger.warn(`order ${order.id} was not moved to payment_pending: ${String(err)}`);
    }
  }

  /**
   * The one write that means "paid". Conditioned on the order not already
   * being confirmed or cancelled, so a replayed webhook and a poll that raced
   * it cannot both move it.
   */
  private async confirm(record: PaymentIntentRecord, event: PaymentEvent): Promise<void> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', record.orderId));
    if (!found) return;
    const order = toResponse(found);
    if (order.status === 'confirmed' || order.status === 'cancelled') return;

    const now = new Date().toISOString();
    await this.repo.transactWrite([
      {
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Order', record.orderId)),
          UpdateExpression:
            'SET #status = :confirmed, #stage = :stage, #enteredAt = :now, #payment = :payment',
          ConditionExpression: '#status = :awaiting OR #status = :pending',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#stage': 'currentStageId',
            '#enteredAt': 'stageEnteredAt',
            '#payment': 'payment',
          },
          ExpressionAttributeValues: {
            ':confirmed': 'confirmed',
            ':awaiting': 'awaiting_payment',
            ':pending': 'payment_pending',
            ':stage': order.stages[0].id,
            ':now': now,
            ':payment': {
              id: event.paymentId ?? event.intentId,
              // A UPI payment has no card. The field is four digits wide by
              // contract, and what a customer recognises is the handle, which
              // the gateway sends as the instrument label.
              last4: '0000',
              amountMinor: record.amountMinor,
              at: now,
            },
          },
        },
      },
    ]);
  }

  /** A refusal puts the order back where it was, payable again. */
  private async release(record: PaymentIntentRecord): Promise<void> {
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Order', record.orderId)),
            UpdateExpression: 'SET #status = :awaiting',
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':awaiting': 'awaiting_payment',
              ':pending': 'payment_pending',
            },
          },
        },
      ]);
    } catch (err) {
      this.logger.warn(`order ${record.orderId} was not released: ${String(err)}`);
    }
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  HttpCode,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ProblemException } from '../common/problem';
import { runWithTenant } from '../common/tenant-context';
import { TENANT_ID_PATTERN } from '../auth/claims';
import { PaymentIntentResponse } from '@marketplace/contracts';
import { PaymentsService } from './payments.service';
import { LocalUpiProvider } from './local-upi.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * The stand-in for a banking app, used only by the local provider.
   *
   * It signs a Razorpay-shaped payload and posts it to the real webhook route
   * above, so a local run exercises signature verification, the replay claim,
   * the amount re-check and the conditional write -- rather than a shortcut
   * that marks the order paid and proves none of them.
   */
  @Post('local/approve')
  @Public()
  @HttpCode(200)
  async localApprove(@Body() body: { intentId?: string }): Promise<{ approved: boolean }> {
    if (!(this.provider instanceof LocalUpiProvider)) {
      throw new ProblemException(
        'not-found',
        404,
        'Not found',
        'this route exists only where the local payment provider is running',
      );
    }
    const event = await this.provider.getIntent(String(body.intentId ?? ''));
    if (!event) throw new ProblemException('payment-intent-not-found', 404, 'No such payment');

    const raw = JSON.stringify(event);
    await this.webhook(
      { rawBody: Buffer.from(raw, 'utf8') } as RawBodyRequest<Request>,
      this.provider.sign(raw),
    );
    return { approved: event.state === 'paid' };
  }

  /**
   * What the gateway calls when a customer approves, declines, or lets an
   * attempt expire.
   *
   * Unauthenticated by necessity — the caller is not a user of this system —
   * so the signature is the only credential, and it is checked over the raw
   * bytes before anything at all is read out of the body. Every rejection
   * answers the same way: a caller learns whether they signed correctly and
   * nothing else, not whether an order or an intent exists.
   *
   * The tenant is never taken from the message. It is read from the intent
   * record this shop wrote when it started the payment, and validated against
   * the same pattern every other untrusted tenant id is — the argument
   * `sqs-consumer.service.ts` makes at length for the queue.
   */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-payment-signature') signature?: string,
  ): Promise<{ received: true }> {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const event = this.provider.verifyWebhook(raw, signature);
    if (!event) {
      throw new ProblemException(
        'payment-signature-invalid',
        401,
        'Not accepted',
        'the message could not be verified',
      );
    }

    // The tenant came back with the payment, and it is checked against the
    // same pattern every other untrusted tenant id is before it is allowed
    // anywhere near a partition key. A forged one finds no intent and is
    // dropped; it cannot reach another shop's order, because the intent it
    // would have to name lives in that shop's partition.
    if (!TENANT_ID_PATTERN.test(event.tenantId)) {
      return { received: true };
    }

    await runWithTenant(
      { tenantId: event.tenantId, userId: 'system:payments', role: 'admin' },
      async () => {
        try {
          await this.payments.apply(event);
        } catch (err) {
          // An amount that disagrees, or an attempt this shop never started.
          // Answered 200 either way so the gateway stops retrying something
          // that will never succeed, and logged rather than swallowed.
          this.logger.warn(`webhook for ${event.intentId} was not applied: ${String(err)}`);
        }
      },
    );
    return { received: true };
  }
}

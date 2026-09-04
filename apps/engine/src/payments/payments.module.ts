import { Module } from '@nestjs/common';
import { ENV, EnvConfig } from '../config/env.schema';
import { FakeCardProvider } from './fake-card.provider';
import { LocalUpiProvider } from './local-upi.provider';
import { RazorpayProvider } from './razorpay.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Which gateway is in play, decided once, here.
 *
 * Razorpay registers only where its credentials exist — the posture the media
 * bucket already uses — and everywhere else the local provider runs. That is
 * not a stub that marks orders paid: it hands the browser a page standing in
 * for a banking app, and that page signs a payload and posts it to this
 * service's *real* webhook route, so signature verification, replay dedupe and
 * the conditional write are exercised by every local run.
 *
 * `FakeCardProvider` is still the card path; nothing about it changed.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    FakeCardProvider,
    LocalUpiProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV, LocalUpiProvider],
      useFactory: (env: EnvConfig, local: LocalUpiProvider): PaymentProvider =>
        env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
          ? new RazorpayProvider(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.PAYMENT_WEBHOOK_SECRET)
          : local,
    },
  ],
  exports: [PAYMENT_PROVIDER, PaymentsService, LocalUpiProvider],
})
export class PaymentsModule {}

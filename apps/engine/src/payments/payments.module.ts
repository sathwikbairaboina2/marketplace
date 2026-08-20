import { Module } from '@nestjs/common';
import { FakeCardProvider } from './fake-card.provider';
import { PAYMENT_PROVIDER } from './payment.provider';

/**
 * One implementation today. A real provider slots in here — behind the same
 * token — without touching the order flow.
 */
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: FakeCardProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}

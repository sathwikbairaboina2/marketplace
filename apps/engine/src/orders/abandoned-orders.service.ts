import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrderRecord } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { runWithTenant } from '../common/tenant-context';
import { normalizeTenantId } from '../persistence/keys';
import { OrderLifecycleService } from './order-lifecycle.service';

/** How long an unpaid order may hold stock before the shop takes it back. */
const ABANDON_AFTER_MS = 30 * 60 * 1000;
/** How often to look. Slow on purpose: this is a broom, not a heartbeat. */
const SWEEP_EVERY_MS = 5 * 60 * 1000;
const PAGE = 100;

/**
 * Gives back the stock that abandoned orders are holding.
 *
 * Checkout takes stock *before* payment, and until UPI that was survivable:
 * the shopper stayed on the page with a card form in front of them, and an
 * abandonment was a browser tab closing. UPI hands them to another
 * application entirely. Somebody who opens their banking app, thinks better of
 * it and never comes back leaves a one-of-a-kind mug reserved indefinitely,
 * and the merchant's only remedy was to notice and cancel it by hand.
 *
 * It cancels through `OrderLifecycleService.cancel`, which already restores
 * stock in the mirror image of checkout's transaction -- there is no second
 * implementation of that here, deliberately.
 */
@Injectable()
export class AbandonedOrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbandonedOrdersService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    private readonly repo: DynamoRepository,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  onModuleInit(): void {
    // Rides the same switch as the queue consumer: one process per deployment
    // should be doing background work, and tests should be doing none.
    if (!this.env.SQS_CONSUMER_ENABLED) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    // Not `unref`ed: a sweep that a shutdown interrupts is safe to lose, but a
    // timer that keeps the process alive is easier to reason about in a
    // container that is meant to run until it is stopped.
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Every unpaid order old enough to have been abandoned, whatever shop it
   * belongs to. Returns how many were reclaimed, so a test asserts on the
   * outcome rather than on a log line.
   */
  async sweep(now = Date.now()): Promise<number> {
    let reclaimed = 0;
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.repo.scanUnpaidOrders(PAGE);
    } catch (err) {
      this.logger.warn(`sweep could not read: ${String(err)}`);
      return 0;
    }

    for (const row of rows) {
      const order = row as unknown as OrderRecord & { PK?: string };
      if (now - Date.parse(order.createdAt) <= ABANDON_AFTER_MS) continue;

      // The tenant comes off the item's own partition key -- the sweep never
      // takes one from anywhere a caller could reach.
      const tenantId = normalizeTenantId(String(order.PK ?? ''));
      if (!tenantId) continue;

      try {
        await runWithTenant(
          { tenantId, userId: 'system:sweeper', role: 'admin' },
          () => this.lifecycle.cancel(order.id),
        );
        reclaimed += 1;
        this.logger.log(`reclaimed the stock held by abandoned order ${order.id}`);
      } catch (err) {
        // Somebody paid, or cancelled, between the read and the write. That is
        // the condition doing its job, not a failure worth stopping the sweep.
        this.logger.debug(`order ${order.id} was not reclaimed: ${String(err)}`);
      }
    }
    return reclaimed;
  }
}

import { Injectable } from '@nestjs/common';
import {
  Card,
  CreateOrder,
  OrderRecord,
  OrderResponse,
  Page,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { entitySk, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { assertAdmin } from '../common/roles';
import { toResponse } from './order-response';
import { OrderCheckoutService } from './order-checkout.service';
import { OrderPaymentService } from './order-payment.service';
import { OrderLifecycleService } from './order-lifecycle.service';

export type { OrderResponse };

/**
 * The one order surface the controller and the other modules talk to. Reads
 * live here; each write has a service of its own (checkout, payment,
 * lifecycle) and is delegated to, so a caller sees one API while the
 * transaction logic stays in files small enough to hold in one head.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly checkout: OrderCheckoutService,
    private readonly payment: OrderPaymentService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  /**
   * Exposed for ThreadsService: one normalisation of a stored order, not two.
   * An order written before stages existed must read the same wherever it is read.
   */
  toResponsePublic(record: OrderRecord): OrderResponse {
    return toResponse(record);
  }

  create(input: CreateOrder, opts: { awaitPayment?: boolean } = {}): Promise<OrderResponse> {
    return this.checkout.create(input, opts);
  }

  pay(id: string, card: Card): Promise<OrderResponse> {
    return this.payment.pay(id, card);
  }

  advance(id: string, expectedStageId: string): Promise<OrderResponse> {
    return this.lifecycle.advance(id, expectedStageId);
  }

  cancel(id: string): Promise<OrderResponse> {
    return this.lifecycle.cancel(id);
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
    // A tenant admin may read any order in their own tenant: they are the ones
    // who pack and dispatch it, and `advance` and the seller's side of the
    // message thread both already work this way. Everyone else sees only their
    // own, and a stranger gets 404 rather than 403 -- a 403 would confirm the
    // order exists to somebody not allowed to see it.
    const principal = currentPrincipal();
    if (!found || (found.userId !== principal.userId && principal.role !== 'admin')) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    return toResponse(found);
  }

  /**
   * Every order in the tenant, newest first. Admin only: this is the seller's
   * queue of work, and it deliberately crosses the per-user scoping that
   * `listForCurrentUser` applies, so it is gated rather than filtered.
   */
  async listForTenant(limit: number, cursor: string | null): Promise<Page<OrderResponse>> {
    assertAdmin('list the shop orders');
    const page = await this.repo.queryPrefix<OrderRecord>(skPrefix('Order'), { limit, cursor });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
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

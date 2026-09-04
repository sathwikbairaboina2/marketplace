import { Injectable } from '@nestjs/common';
import {
  Card,
  CreateOrder,
  normalizeEmailHandle,
  normalizePhoneHandle,
  ORDER_REFERENCE_PATTERN,
  OrderRecord,
  OrderResponse,
  Page,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { customerOrderPrefix, entitySk, orderRefSk, skPrefix } from '../persistence/keys';
import { deriveIdFrom } from '../common/ids';
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

  create(input: CreateOrder, opts: { awaitPayment?: boolean; guestEmail?: string } = {}): Promise<OrderResponse> {
    return this.checkout.create(input, opts);
  }

  pay(id: string, card: Card, opts: { guestEmail?: string } = {}): Promise<OrderResponse> {
    return this.payment.pay(id, card, opts);
  }

  advance(id: string, expectedStageId: string): Promise<OrderResponse> {
    return this.lifecycle.advance(id, expectedStageId);
  }

  settleBalance(id: string): Promise<OrderResponse> {
    return this.lifecycle.settleBalance(id);
  }

  cancel(id: string, opts: { guestEmail?: string } = {}): Promise<OrderResponse> {
    return this.lifecycle.cancel(id, opts);
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
   * A guest finding their order again from a fresh browser: the id and the
   * email they gave at checkout, both required, compared case-insensitively.
   * One 404 for every miss -- no such order, an order that was not a guest's,
   * a wrong email -- so the lookup cannot be used to learn which of those it was.
   */
  async lookup(orderId: string, email: string): Promise<OrderResponse> {
    // Either form. A printed reference resolves through its pointer item; a
    // full id is the direct get it always was. A pointer that names an order
    // which is gone falls through to the same 404 as everything else here.
    const id = ORDER_REFERENCE_PATTERN.test(orderId)
      ? (await this.repo.get<{ orderId: string }>(orderRefSk(orderId)))?.orderId
      : orderId;
    const found = id ? await this.repo.get<OrderRecord>(entitySk('Order', id)) : null;
    if (!found?.guestEmail || found.guestEmail.toLowerCase() !== email.trim().toLowerCase()) {
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

  /**
   * Everything one customer has bought, found by the number or the address
   * they gave at checkout -- the two handles a shop with no accounts has.
   *
   * The merchant's version of this is the same query: she looks a person up by
   * phone number, which is what her customers are. A miss and an unknown
   * customer answer identically, so this cannot be used to learn who shops
   * here.
   */
  async historyFor(handle: { email?: string; phone?: string }): Promise<OrderResponse[]> {
    const normalized = handle.phone
      ? normalizePhoneHandle(handle.phone)
      : handle.email
        ? normalizeEmailHandle(handle.email)
        : null;
    if (!normalized) return [];

    const pointers = await this.repo.queryPrefix<{ orderId: string }>(
      customerOrderPrefix(deriveIdFrom(normalized)),
      { limit: 50, cursor: null },
    );
    const orders = await Promise.all(
      pointers.items.map((pointer) => this.repo.get<OrderRecord>(entitySk('Order', pointer.orderId))),
    );
    return orders
      .filter((order): order is OrderRecord => Boolean(order))
      .map(toResponse)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

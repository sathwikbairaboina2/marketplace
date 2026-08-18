import { Injectable } from '@nestjs/common';
import {
  CreateMessage,
  MessageRecord,
  MessageResponse,
  OrderRecord,
  OrderResponse,
  Page,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { entitySk, messagePrefix, messageSk } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class ThreadsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly orders: OrdersService,
  ) {}

  /**
   * The buyer who placed the order, or any admin of the tenant. Anybody else is
   * told the order does not exist, matching `OrdersService.get` -- a 403 would
   * confirm it exists to somebody not allowed to see it.
   */
  private async participantOrder(orderId: string): Promise<OrderResponse> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', orderId));
    const principal = currentPrincipal();
    if (!found || (found.userId !== principal.userId && principal.role !== 'admin')) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    // Read through OrdersService's normalisation rather than a second copy of
    // it, so an order written before stages existed reads the same here.
    return this.orders.toResponsePublic(found);
  }

  async post(orderId: string, input: CreateMessage): Promise<MessageResponse> {
    const order = await this.participantOrder(orderId);

    if (order.status !== 'confirmed') {
      throw new ProblemException(
        'order-not-messageable',
        409,
        'Order is closed to messages',
        `order ${orderId} is ${order.status}`,
      );
    }

    const stage = order.stages.find((s) => s.id === order.currentStageId);
    if (!stage?.messaging) {
      throw new ProblemException(
        'stage-not-messageable',
        409,
        'This stage has no message thread',
        `the shop did not enable messages at ${stage?.name ?? 'this stage'}`,
        { stageId: order.currentStageId },
      );
    }

    const principal = currentPrincipal();
    const id = newId();
    const message: MessageResponse = {
      entityType: 'Message',
      id,
      orderId,
      // Stamped from the order the server just read, never from the request: a
      // past stage cannot be addressed, so a closed thread cannot be written to.
      stageId: order.currentStageId,
      authorUserId: principal.userId,
      authorRole: principal.userId === order.userId ? 'buyer' : 'seller',
      body: input.body,
      createdAt: new Date().toISOString(),
    };

    await this.repo.put(messageSk(orderId, id), message);
    return message;
  }

  async list(orderId: string, limit: number, cursor: string | null): Promise<Page<MessageResponse>> {
    await this.participantOrder(orderId);
    // Closed threads come back too -- they are the history. The client groups by
    // stageId against the order's own snapshot, so a renamed stage still shows
    // under the name the order was placed with.
    const page = await this.repo.queryPrefix<MessageRecord>(messagePrefix(orderId), {
      limit,
      cursor,
    });
    return {
      items: page.items.map(({ PK: _pk, SK: _sk, ...rest }) => rest),
      nextCursor: page.nextCursor,
    };
  }
}

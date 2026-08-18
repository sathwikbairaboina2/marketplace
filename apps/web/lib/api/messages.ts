import { MessageResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(MessageResponseSchema);

/**
 * Every message on the order, closed threads included -- they are the history.
 * The caller groups them by `stageId` against the order's own snapshot, so a
 * stage the owner has since renamed still displays under the name the order was
 * placed with.
 */
export const listMessages = (orderId: string, limit: number, cursor: string | null) =>
  request(`/orders/${orderId}/messages`, {
    query: { limit, cursor: cursor ?? undefined },
    schema: Page,
  });

/**
 * The stage is not a parameter: the engine stamps the one the order is currently
 * in. That is what makes a closed thread unwritable rather than merely hidden.
 */
export const postMessage = (orderId: string, body: string) =>
  request(`/orders/${orderId}/messages`, {
    method: 'POST',
    body: { body },
    schema: MessageResponseSchema,
  });

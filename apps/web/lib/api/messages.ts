import { MessageResponseSchema, pageOf, type MessageResponse } from '@marketplace/contracts';
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

/** One page is the engine's maximum; a thread longer than this needs several. */
const PAGE = 100;

/**
 * How many pages one order's thread may cost. A thread is per order and stages
 * cap at MAX_STAGES, so a conversation past a thousand messages is not a
 * conversation any more -- but the budget is here so a pathological order cannot
 * make the page fetch forever, in the spirit of the engine's own read budget.
 */
const PAGE_BUDGET = 10;

/**
 * The whole thread, oldest first.
 *
 * Not a single 100-message page: the engine returns a thread ascending, so a
 * page-one read of a long thread shows the oldest hundred messages and silently
 * drops the newest -- the ones anybody actually wants. Returns `truncated` when
 * the budget ran out, so a caller can say so rather than quietly lying.
 */
export async function listWholeThread(orderId: string): Promise<{
  items: MessageResponse[];
  truncated: boolean;
}> {
  const items: MessageResponse[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_BUDGET; page += 1) {
    const next = await listMessages(orderId, PAGE, cursor);
    items.push(...next.items);
    cursor = next.nextCursor;
    if (!cursor) return { items, truncated: false };
  }
  return { items, truncated: true };
}

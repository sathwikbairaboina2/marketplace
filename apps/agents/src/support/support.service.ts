import { Inject, Injectable } from '@nestjs/common';
import { SupportAskResponse } from '@marketplace/contracts';
import { LLM, LlmProvider } from '../llm/llm.provider';
import { EngineClient } from '../engine-client/engine.client';

const SYSTEM = [
  'You are the order-support assistant for a small shop.',
  'Answer the customer using ONLY the order facts provided below their question.',
  'Refer to orders by their reference (the last six characters of the id).',
  'If the facts do not answer the question, say so and suggest messaging the seller from the order page.',
  'Never invent an order, a status, a date or a refund. 2-4 plain sentences, no lists.',
].join(' ');

interface OrderFacts {
  id: string;
  status: string;
  currentStageId: string | null;
  stages?: Array<{ id: string; name: string }>;
  totalAmountMinor: number;
  currency: string;
  createdAt: string;
}

/** One order, flattened to the words the model may use. */
function describe(order: OrderFacts): string {
  const ref = order.id.slice(-6);
  const stage =
    order.status === 'confirmed'
      ? (order.stages?.find((s) => s.id === order.currentStageId)?.name ?? 'in progress')
      : null;
  const state =
    order.status === 'awaiting_payment'
      ? 'awaiting payment (reserved but unpaid)'
      : order.status === 'cancelled'
        ? 'cancelled'
        : `paid, currently at stage "${stage}"`;
  const amount = `${(order.totalAmountMinor / 100).toFixed(2)} ${order.currency}`;
  return `Order ${ref}: placed ${order.createdAt.slice(0, 10)}, ${amount}, ${state}.`;
}

@Injectable()
export class SupportService {
  constructor(
    @Inject(LLM) private readonly llm: LlmProvider,
    private readonly engine: EngineClient,
  ) {}

  async ask(question: string, token: string): Promise<SupportAskResponse> {
    // The engine scopes /orders to the token's own user; this service never
    // sees, and can never leak, anybody else's orders.
    const orders = (await this.engine.listOrders(token)) as unknown as OrderFacts[];

    // No orders is a fact, not a generation task -- answered directly rather
    // than asking a model to phrase an empty list.
    if (orders.length === 0) {
      return {
        answer:
          "You haven't placed any orders yet, so there's nothing to track. Once you order, its progress appears under Orders.",
      };
    }

    const facts = orders.map(describe).join('\n');
    const answer = await this.llm.text({
      system: SYSTEM,
      messages: [{ role: 'user', content: `${question}\n\nOrder facts:\n${facts}` }],
    });
    return { answer: answer.trim().slice(0, 5000) || 'Something went blank — please ask again.' };
  }
}

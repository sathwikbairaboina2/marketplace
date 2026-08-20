import { SupportService } from './support.service';
import { ScriptedLlmProvider } from '../llm/scripted.provider';

const engine = { listOrders: jest.fn() };

const order = (over: Record<string, unknown> = {}) => ({
  id: '01M0G37HX0K2WR8GGNM3ZPCQHS',
  status: 'confirmed',
  currentStageId: 's1',
  stages: [{ id: 's1', name: 'Packing' }],
  totalAmountMinor: 3000,
  currency: 'USD',
  createdAt: '2026-08-20T12:00:00.000Z',
  ...over,
});

describe('SupportService', () => {
  const llm = new ScriptedLlmProvider();
  const service = new SupportService(llm, engine as never);
  beforeEach(() => {
    llm.reset();
    engine.listOrders.mockReset();
  });

  it('answers an empty order book directly, without a model call', async () => {
    engine.listOrders.mockResolvedValue([]);
    const result = await service.ask('where is my order?', 'tok');
    expect(result.answer).toContain("haven't placed any orders");
    expect(llm.calls).toHaveLength(0);
  });

  it('forwards the caller token so the engine applies their own scoping', async () => {
    engine.listOrders.mockResolvedValue([]);
    await service.ask('anything?', 'the-caller-token');
    expect(engine.listOrders).toHaveBeenCalledWith('the-caller-token');
  });

  it('grounds the model in the orders, by reference, stage name included', async () => {
    engine.listOrders.mockResolvedValue([
      order(),
      order({ id: '01M0G37HX0K2WR8GGNM3ZAWAIT', status: 'awaiting_payment', currentStageId: null }),
    ]);
    llm.pushText('Order ZPCQHS is being packed.');

    const result = await service.ask('where is my mug?', 'tok');
    expect(result.answer).toBe('Order ZPCQHS is being packed.');
    const sent = llm.calls[0].messages[0] as { content: string };
    expect(sent.content).toContain('where is my mug?');
    expect(sent.content).toContain('ZPCQHS');
    expect(sent.content).toContain('stage "Packing"');
    expect(sent.content).toContain('awaiting payment (reserved but unpaid)');
    // The full ULID never reaches the model as the only handle -- but the
    // reference must; and no fabricated fields arrive.
    expect(sent.content).toContain('30.00 USD');
  });
});

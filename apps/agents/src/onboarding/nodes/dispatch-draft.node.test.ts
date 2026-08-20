import { makeDispatchDraftNode } from './dispatch-draft.node';
import { defaultOnboardingState } from '../state';
import type { StorefrontConfig } from '@marketplace/contracts';
import type { EngineClient } from '../../engine-client/engine.client';
import type { RunContext } from '../../graph/context';

const draft: StorefrontConfig = {
  presetId: 'artisan',
  overrides: {},
  about: { title: 't', sections: [{ heading: 'h', body: 'b' }] },
  banners: [],
  businessProfile: { kind: 'k', name: 'n', tone: 't', audience: 'a' },
};

const ctx: RunContext = {
  principal: { tenantId: 'acme', userId: 'u1', role: 'admin' } as RunContext['principal'],
  authToken: 'owner-token',
  threadId: '01J8Z5X9T7QK4W2M6N3P8R5V1C',
};

describe('dispatchDraft', () => {
  it('writes the draft through the engine with the caller token and lands drafted', async () => {
    const engine = { putStorefrontDraft: jest.fn().mockResolvedValue(undefined) };
    const node = makeDispatchDraftNode({ engine: engine as unknown as EngineClient }, ctx);

    const result = await node({ ...defaultOnboardingState, draft });

    expect(engine.putStorefrontDraft).toHaveBeenCalledWith(draft, 'owner-token');
    expect(result.phase).toBe('drafted');
    expect(result.messages?.[0].content).toMatch(/preview/i);
  });

  it('throws a typed internal error without an assembled draft', async () => {
    const engine = { putStorefrontDraft: jest.fn() };
    const node = makeDispatchDraftNode({ engine: engine as unknown as EngineClient }, ctx);

    await expect(node(defaultOnboardingState)).rejects.toMatchObject({
      problem: { status: 500 },
    });
    expect(engine.putStorefrontDraft).not.toHaveBeenCalled();
  });
});

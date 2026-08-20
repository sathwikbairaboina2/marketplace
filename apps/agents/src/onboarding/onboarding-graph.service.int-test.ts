import { ulid } from 'ulid';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { OnboardingSnapshotSchema } from '@marketplace/contracts';
import { ScriptedLlmProvider } from '../llm/scripted.provider';
import { EngineClient } from '../engine-client/engine.client';
import { createCheckpointer } from '../graph/checkpointer';
import { EnvConfig } from '../config/env.schema';
import { OnboardingGraphService } from './onboarding-graph.service';

const openCheckpointers: RedisSaver[] = [];

async function trackedCheckpointer(env: EnvConfig): Promise<RedisSaver> {
  const checkpointer = await createCheckpointer(env);
  openCheckpointers.push(checkpointer);
  return checkpointer;
}

afterAll(async () => {
  await Promise.all(openCheckpointers.map((c) => c.end()));
});

const env = {
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  DRAFT_MAX_ATTEMPTS: 3,
  THREAD_TTL_SECONDS: 3600,
} as EnvConfig;

const ctx = {
  principal: { tenantId: 'tenant_a', userId: 'user-1', role: 'admin' as never },
  authToken: 'owner-token',
};

const themePick = { presetId: 'artisan', accent: '#8a3f1f' };
const content = (headline: string) => ({
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      slot: 'hero',
      headline,
      subline: 'Stoneware and wood, signed by the maker.',
      ctaLabel: 'Browse the shelf',
      ctaHref: '/products',
    },
  ],
});

jest.setTimeout(60_000);

describe('OnboardingGraphService', () => {
  let llm: ScriptedLlmProvider;
  let putStorefrontDraft: jest.Mock;
  let service: OnboardingGraphService;

  beforeAll(async () => {
    llm = new ScriptedLlmProvider();
    putStorefrontDraft = jest.fn().mockResolvedValue(undefined);
    const engine = { putStorefrontDraft } as unknown as EngineClient;
    service = new OnboardingGraphService(env, llm, engine, await trackedCheckpointer(env));
  });

  beforeEach(() => putStorefrontDraft.mockClear());

  it('asks a question while the profile is incomplete, and the question survives the checkpoint', async () => {
    const threadId = ulid();
    llm.pushStructured({ complete: false, profile: null, question: 'What is your business called?' });

    const first = await service.run({ threadId, ctx, content: 'I make pottery' });
    expect(first.kind).toBe('onboarding');
    expect(first.phase).toBe('gathering');
    expect(first.draft).toBeNull();
    expect(first.messages[first.messages.length - 1].content).toBe('What is your business called?');
    expect(() => OnboardingSnapshotSchema.parse(first)).not.toThrow();
    expect(putStorefrontDraft).not.toHaveBeenCalled();
  });

  it('completes the profile, generates a draft and dispatches it to the engine', async () => {
    const threadId = ulid();
    llm.pushStructured({
      complete: true,
      profile: { kind: 'ceramics studio', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
      question: '',
    });
    llm.pushStructured(themePick);
    llm.pushStructured(content('Objects with a thumbprint'));

    const out = await service.run({ threadId, ctx, content: 'Kiln & Loom, warm, gift shoppers' });

    expect(out.phase).toBe('drafted');
    expect(out.draft?.presetId).toBe('artisan');
    expect(out.draft?.banners[0].headline).toBe('Objects with a thumbprint');
    expect(putStorefrontDraft).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: 'artisan' }),
      'owner-token',
    );
  });

  it('treats a message on a drafted thread as feedback and re-dispatches a revision', async () => {
    const threadId = ulid();
    llm.pushStructured({
      complete: true,
      profile: { kind: 'ceramics studio', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
      question: '',
    });
    llm.pushStructured(themePick);
    llm.pushStructured(content('Poetry about clay'));
    await service.run({ threadId, ctx, content: 'Kiln & Loom, warm, gift shoppers' });

    // Feedback run: no profile call (short-circuits), straight to regenerate.
    llm.pushStructured(themePick);
    llm.pushStructured(content('Small-batch ceramics, made to be used'));
    const revised = await service.run({ threadId, ctx, content: 'less poetic headline please' });

    expect(revised.phase).toBe('drafted');
    expect(revised.draft?.banners[0].headline).toBe('Small-batch ceramics, made to be used');
    expect(putStorefrontDraft).toHaveBeenCalledTimes(2);
  });

  it('returns a schema-valid snapshot for a thread that was never run', async () => {
    const snapshot = await service.snapshot(ulid());
    expect(snapshot.phase).toBe('gathering');
    expect(() => OnboardingSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

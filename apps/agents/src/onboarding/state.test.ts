import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { OnboardingSnapshotSchema } from '@marketplace/contracts';
import {
  ONBOARDING_FIELD_DEFAULTS,
  OnboardingAnnotation,
  defaultOnboardingState,
  toOnboardingSnapshot,
} from './state';

const threadId = '01J8Z5X9T7QK4W2M6N3P8R5V1C';

describe('toOnboardingSnapshot', () => {
  it('maps langchain messages and carries the draft', () => {
    const snapshot = toOnboardingSnapshot(threadId, {
      ...defaultOnboardingState,
      messages: [new HumanMessage('a pottery studio'), new AIMessage('lovely')],
    });
    expect(snapshot.kind).toBe('onboarding');
    expect(snapshot.messages).toEqual([
      { role: 'user', content: 'a pottery studio' },
      { role: 'assistant', content: 'lovely' },
    ]);
    expect(snapshot.draft).toBeNull();
  });

  it('omits the working slices from the client view', () => {
    const snapshot = toOnboardingSnapshot(threadId, {
      ...defaultOnboardingState,
      presetId: 'artisan',
    });
    expect(snapshot).not.toHaveProperty('presetId');
    expect(snapshot).not.toHaveProperty('profile');
    expect(snapshot).not.toHaveProperty('overrides');
  });

  it('produces a snapshot that satisfies the published contract', () => {
    expect(() =>
      OnboardingSnapshotSchema.parse(toOnboardingSnapshot(threadId, defaultOnboardingState)),
    ).not.toThrow();
  });
});

describe('ONBOARDING_FIELD_DEFAULTS', () => {
  it('has exactly one entry per OnboardingAnnotation channel other than messages', () => {
    const channelKeys = Object.keys(OnboardingAnnotation.spec).filter((key) => key !== 'messages');
    expect(Object.keys(ONBOARDING_FIELD_DEFAULTS).sort()).toEqual([...channelKeys].sort());
  });
});

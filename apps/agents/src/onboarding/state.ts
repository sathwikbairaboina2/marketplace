import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import {
  AboutPage,
  Banner,
  BusinessProfile,
  BusinessRequirements,
  OnboardingPhase,
  OnboardingSnapshot,
  PresetId,
  SetupPlan,
  StorefrontConfig,
  ThemeOverrides,
} from '@marketplace/contracts';
import { toChatMessages } from '../graph/state';

/**
 * Same construction as ../graph/state.ts, same reason: the channels and the
 * defaults read from one object so they cannot drift, and the channel-keys
 * test in state.test.ts pins the pairing.
 */
export const ONBOARDING_FIELD_DEFAULTS = {
  phase: 'gathering' as OnboardingPhase,
  profile: null as BusinessProfile | null,
  requirements: null as BusinessRequirements | null,
  setupPlan: null as SetupPlan | null,
  // How many questions the interview has already asked. The cap that reads it
  // is what stops an adaptive interview that never feels satisfied.
  questionCount: 0,
  presetId: null as PresetId | null,
  overrides: null as ThemeOverrides | null,
  about: null as AboutPage | null,
  banners: null as Banner[] | null,
  draft: null as StorefrontConfig | null,
};

const replace = <T>(defaultValue: () => T) =>
  Annotation<T>({ reducer: (_current: T, next: T) => next, default: defaultValue });

export const OnboardingAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  phase: replace<OnboardingPhase>(() => ONBOARDING_FIELD_DEFAULTS.phase),
  profile: replace<BusinessProfile | null>(() => ONBOARDING_FIELD_DEFAULTS.profile),
  requirements: replace<BusinessRequirements | null>(
    () => ONBOARDING_FIELD_DEFAULTS.requirements,
  ),
  setupPlan: replace<SetupPlan | null>(() => ONBOARDING_FIELD_DEFAULTS.setupPlan),
  questionCount: replace<number>(() => ONBOARDING_FIELD_DEFAULTS.questionCount),
  presetId: replace<PresetId | null>(() => ONBOARDING_FIELD_DEFAULTS.presetId),
  overrides: replace<ThemeOverrides | null>(() => ONBOARDING_FIELD_DEFAULTS.overrides),
  about: replace<AboutPage | null>(() => ONBOARDING_FIELD_DEFAULTS.about),
  banners: replace<Banner[] | null>(() => ONBOARDING_FIELD_DEFAULTS.banners),
  draft: replace<StorefrontConfig | null>(() => ONBOARDING_FIELD_DEFAULTS.draft),
});

export type OnboardingState = typeof OnboardingAnnotation.State;

/** See defaultAgentState in ../graph/state.ts for why this exists. */
export const defaultOnboardingState: OnboardingState = {
  messages: [],
  ...ONBOARDING_FIELD_DEFAULTS,
};

/**
 * The client view. The working slices (profile, requirements, presetId,
 * overrides, about, banners, questionCount) stay internal: the wizard renders the assembled draft or nothing.
 */
export function toOnboardingSnapshot(threadId: string, state: OnboardingState): OnboardingSnapshot {
  return {
    threadId,
    kind: 'onboarding',
    phase: state.phase,
    messages: toChatMessages(state.messages),
    draft: state.draft,
    setupPlan: state.setupPlan,
  };
}

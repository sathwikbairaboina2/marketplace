import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BusinessProfileSchema, BusinessRequirementsSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { INTERVIEW_SYSTEM } from '../prompts';

/**
 * The ceiling on an adaptive interview. The model decides when it knows
 * enough; this decides when it has had long enough to decide.
 */
export const ASK_MAX = 5;

/**
 * Loose on purpose, like ThemeResultSchema next door: the two nested objects
 * are validated against the real contracts below, where a near-miss costs that
 * slice rather than failing the structured call outright.
 */
const InterviewResultSchema = z.object({
  satisfied: z.boolean(),
  profile: z
    .object({ kind: z.string(), name: z.string(), tone: z.string(), audience: z.string() })
    .nullable(),
  requirements: z
    .object({
      sellsWhat: z.string(),
      categories: z.array(z.string()),
      fulfilment: z.string(),
      priceBand: z.string(),
      differentiator: z.string(),
    })
    .nullable(),
  question: z.string(),
});

type RawRequirements = NonNullable<z.infer<typeof InterviewResultSchema>['requirements']>;

/**
 * What the owner books a place at, as opposed to buys.
 *
 * Matched on whole words, and deliberately not on "book": a secondhand
 * bookshop sells books and takes no bookings, and reading it as bookable
 * would hand a shop full of paperbacks an events-first storefront.
 */
const BOOKABLE_WORDS = /\b(bookable|booking|bookings|class|classes|course|courses|event|events|session|sessions|appointment|appointments|retreat|retreats|workshop|workshops)\b/;
const GOODS_WORDS = /\b(good|goods|product|products|item|items|physical|stock|merchandise)\b/;

/**
 * Absent any bookable signal, a shop sells things.
 *
 * Guessing costs the owner one radio click in a Setup tab they confirm before
 * anything is applied. Refusing to guess costs them the whole plan, which is
 * how a secondhand bookshop answering "books and stationery" -- a phrase
 * matching neither list -- ended up with no setup at all.
 */
const SELLS_WHAT_FALLBACK = 'goods';

/**
 * A small model reliably describes the right business in the wrong shape: it
 * writes "physical goods" where the enum wants "goods", or returns eleven
 * categories when the contract caps eight.
 *
 * Normalising first costs nothing when the model was already right, and is the
 * difference between a setup plan and no setup plan when it was not. The four
 * free-text fields are still gated: an empty fulfilment or price band rejects
 * the requirements outright, so this widens what counts as a valid answer
 * without inventing an answer that was never given.
 */
function coerceRequirements(raw: RawRequirements): unknown {
  const said = String(raw.sellsWhat ?? '').toLowerCase();
  const bookable = BOOKABLE_WORDS.test(said);
  const goods = GOODS_WORDS.test(said);
  const sellsWhat = said.includes('both') || (bookable && goods)
    ? 'both'
    : bookable
      ? 'bookable'
      : goods
        ? 'goods'
        : SELLS_WHAT_FALLBACK;

  const trimmed = (value: string, max: number) => String(value ?? '').trim().slice(0, max);

  return {
    sellsWhat,
    categories: (raw.categories ?? [])
      .map((category) => trimmed(category, 60))
      .filter(Boolean)
      .slice(0, 8),
    fulfilment: trimmed(raw.fulfilment, 200),
    priceBand: trimmed(raw.priceBand, 200),
    differentiator: trimmed(raw.differentiator, 400),
  };
}

export function makeInterviewNode(deps: { llm: LlmProvider; askMax: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    // A re-run of the wizard resumes what it learned; the owner is not
    // interrogated twice.
    if (state.profile) return { phase: 'generating' };

    const result = await deps.llm.structured({
      system: INTERVIEW_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: InterviewResultSchema,
      name: 'business_interview',
    });

    const profile = result.profile ? BusinessProfileSchema.safeParse(result.profile) : null;
    const requirements = result.requirements
      ? BusinessRequirementsSchema.safeParse(coerceRequirements(result.requirements))
      : null;

    // The floor. `satisfied` is worth nothing without a profile that parses:
    // a model that declares victory on "hi" does not get to.
    const grounded = profile?.success === true;
    // The cap, counting the question this turn would ask.
    const atCap = state.questionCount + 1 >= deps.askMax;

    if (grounded && (result.satisfied || atCap)) {
      return {
        phase: 'generating',
        profile: profile.data,
        // Partial requirements stay null: the needs inference builds no plan
        // rather than a plan from half-known facts.
        requirements: requirements?.success ? requirements.data : null,
      };
    }

    const question = result.question.trim() || 'What kind of business are you setting up?';
    return {
      phase: 'gathering',
      questionCount: state.questionCount + 1,
      messages: [new AIMessage(question)],
    };
  };
}

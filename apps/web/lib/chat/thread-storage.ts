/**
 * Where the two chat sockets remember which thread they were on.
 *
 * Both keys live in sessionStorage, which outlives a sign-out: the tab keeps
 * them while the token that made them is thrown away. A thread left behind
 * belongs to whoever signed in last, so resuming it as the next owner answers
 * thread-not-found -- and a wizard with no thread drops every message typed
 * into it without a word. Sign-out clears both; the sockets recover on their
 * own if one survives anyway.
 */
export const ONBOARDING_THREAD_KEY = 'marketplace.onboardingThreadId';
export const AGENT_THREAD_KEY = 'marketplace.threadId';

export function clearThreadIds(): void {
  sessionStorage.removeItem(ONBOARDING_THREAD_KEY);
  sessionStorage.removeItem(AGENT_THREAD_KEY);
}

/** The problem type the agents service answers with for a thread it cannot find. */
export const THREAD_NOT_FOUND = 'thread-not-found';

export function isThreadNotFound(problem: { type?: string }): boolean {
  return problem.type?.endsWith(`/${THREAD_NOT_FOUND}`) === true;
}

import {
  ApplySetupPlanResponseSchema,
  CopywriterDraftResponseSchema,
  SupportAskResponseSchema,
  type ApplySetupPlanRequest,
  type CopywriterDraftRequest,
} from '@marketplace/contracts';
import { AGENTS_URL } from '../env';
import { request } from './http';

/** One-shot description draft; nothing is stored -- the form field is the result. */
export const draftCopy = (body: CopywriterDraftRequest) =>
  request('/api/v1/copywriter/draft', {
    method: 'POST',
    body,
    schema: CopywriterDraftResponseSchema,
    base: AGENTS_URL,
  });

/** A buyer's question, answered from their own orders. */
export const askSupport = (question: string) =>
  request('/api/v1/support/ask', {
    method: 'POST',
    body: { question },
    schema: SupportAskResponseSchema,
    base: AGENTS_URL,
  });

/**
 * Applies the subset of the setup plan the owner ticked: the storefront keys
 * land on the draft immediately, the field additions become proposed flows.
 */
export const applySetupPlan = (body: ApplySetupPlanRequest) =>
  request('/api/v1/setup-plan/apply', {
    method: 'POST',
    body,
    schema: ApplySetupPlanResponseSchema,
    base: AGENTS_URL,
  });

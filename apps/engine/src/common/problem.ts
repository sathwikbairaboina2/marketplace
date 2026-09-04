import { HttpException } from '@nestjs/common';

export type ProblemType =
  | 'insufficient-stock'
  | 'price-changed'
  | 'event-at-capacity'
  | 'schema-validation-failed'
  | 'unsupported-schema-change'
  | 'schema-version-conflict'
  | 'too-many-line-items'
  | 'mixed-currency-order'
  // A second admin saved the shop's order stages while this one was editing.
  | 'pipeline-version-conflict'
  // The order left the stage the caller was looking at before their change landed.
  | 'stage-moved'
  | 'order-at-final-stage'
  | 'order-not-advanceable'
  | 'order-not-cancellable'
  | 'stage-not-messageable'
  | 'order-not-messageable'
  // Publish asked for a storefront draft the tenant has never written.
  | 'storefront-draft-not-found'
  // Banner art was requested but no renderer is configured, or the render
  // failed or timed out. One code for all three: the wizard's recovery is the
  // same -- fall back to CSS art.
  | 'image-gen-unavailable'
  // The card was refused by the provider. Retry with another card.
  | 'payment-declined'
  // The card was accepted but the account cannot cover the amount.
  | 'insufficient-funds'
  // Pay was called on an order that is not awaiting payment.
  | 'order-not-payable'
  // A webhook arrived whose signature does not verify. Never retried, never
  // explained: an attacker learns nothing from this beyond "not accepted".
  | 'payment-signature-invalid'
  // A webhook's amount disagrees with the order it names. The order is the
  // truth; the message is refused rather than reconciled.
  | 'payment-amount-mismatch'
  // A payment attempt was named that this shop has no record of.
  | 'payment-intent-not-found'
  // The customer has not finished approving in their banking app. Not an
  // error the shopper caused, and not a reason to start a second attempt.
  | 'payment-pending'
  // The gateway could not be reached at all. Distinct from a decline: nothing
  // was attempted, so a retry is the right advice.
  | 'payment-provider-unavailable'
  // The customer never approved and the attempt has timed out.
  | 'payment-expired'
  | 'transaction-conflict'
  | 'request-in-progress'
  // Upload rejected on inspection: either the declared type is not accepted, or
  // the file's own bytes disagree with what was declared.
  | 'unsupported-media-type'
  | 'payload-too-large'
  | 'too-many-requests'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-guest'
  | 'not-found'
  | 'invalid-request'
  | 'internal-error';

export interface ProblemBody extends Record<string, unknown> {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

export class ProblemException extends HttpException {
  readonly problem: ProblemBody;

  constructor(
    type: ProblemType,
    status: number,
    title: string,
    detail?: string,
    extra: Record<string, unknown> = {},
  ) {
    const problem: ProblemBody = {
      ...extra,
      type: `https://marketplace.local/problems/${type}`,
      title,
      status,
      ...(detail === undefined ? {} : { detail }),
    };
    super(problem, status);
    this.problem = problem;
    // HttpException.initMessage() only reads `response.message`, which the
    // RFC 9457 body deliberately omits (it uses `title`/`detail` instead) so
    // that field never leaks into the wire format. Without this, `.message`
    // falls back to a useless class-name-derived string ("Problem
    // Exception") for every instance, and anything asserting on it via
    // `.rejects.toThrow(/pattern/)` — a standard, idiomatic way to assert on
    // a thrown error's content — would fail no matter what actually went
    // wrong. This only overrides the in-process Error#message; the
    // client-facing body still comes from `this.problem` via
    // ProblemFilter, so the wire format is unaffected.
    this.message = detail ? `${title}: ${detail}` : title;
  }
}

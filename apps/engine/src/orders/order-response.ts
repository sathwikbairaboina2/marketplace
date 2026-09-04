import {
  DEFAULT_PIPELINE,
  OrderRecord,
  orderReferenceFrom,
  OrderResponse,
} from '@marketplace/contracts';

// The HTTP-facing shape of an order. `OrderRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes and the
// `GSI1PK`/`GSI1SK` attributes used to index orders by owning user. Those are a
// persistence-layer implementation detail and are deliberately not part of the public API
// surface: clients should never see, depend on, or be able to parse the internal key scheme.
//
// Defined as `z.infer<typeof OrderResponseSchema>` in @marketplace/contracts rather than as an
// `Omit<OrderRecord, ...>` here, so the browser client has a runtime schema to validate against
// and cannot drift from the type this service returns.
export type { OrderResponse };

export function toResponse(record: OrderRecord): OrderResponse {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, ...rest } = record;
  // Orders written before stages existed carry none of these attributes. They are
  // filled here rather than backfilled into the table, so the response schema can
  // require them without a migration and without a dual-shape type: an old order
  // reads as a one-stage shop, which is exactly what it was.
  return {
    ...rest,
    // Derived, not stored, for an order written before references existed: the
    // function is pure over the id, so an old order shows the same reference it
    // would have been given. It has no pointer item, so it is findable by its
    // id and not by its reference -- true of every order placed before today.
    reference: rest.reference ?? orderReferenceFrom(rest.id),
    pipelineVersion: rest.pipelineVersion ?? DEFAULT_PIPELINE.version,
    stages: rest.stages ?? DEFAULT_PIPELINE.stages,
    // `!== undefined`, not `??`: an awaiting_payment order legitimately stores
    // `currentStageId: null` and the backfill must not clobber it -- only
    // orders that predate the field entirely get the default.
    currentStageId:
      rest.currentStageId !== undefined ? rest.currentStageId : DEFAULT_PIPELINE.stages[0].id,
    stageEnteredAt: rest.stageEnteredAt ?? rest.createdAt,
  };
}

/**
 * Who may act on an order. The principal owns it, or a tenant admin is asking
 * (widened per-caller by `opts.admin`, because reading and cancelling admit
 * admins on different terms), or the caller produced the guest email the order
 * was placed under.
 *
 * That last clause is the durable key. A guest's principal *is* their ticket
 * (`guest.guard.ts`), and a ticket is a browser's property, not an order's: it
 * is lost to a sign-in, a cleared storage, a second device. Without an email
 * route to the same order, a stranger interrupted on the pay page holds an
 * order nobody can pay for and nobody but the seller can cancel, with its
 * stock reserved the whole time. Compared the way `lookup` compares it, and
 * every miss is one 404 so the answer cannot be read as a probe.
 */
export function mayActOn(
  record: OrderRecord | null | undefined,
  principal: { userId: string; role: string | null },
  opts: { admin?: boolean; guestEmail?: string } = {},
): record is OrderRecord {
  if (!record) return false;
  if (record.userId === principal.userId) return true;
  if (opts.admin && principal.role === 'admin') return true;
  const claimed = opts.guestEmail?.trim().toLowerCase();
  return Boolean(claimed && record.guestEmail && record.guestEmail.toLowerCase() === claimed);
}

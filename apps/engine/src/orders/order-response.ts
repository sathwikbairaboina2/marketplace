import { DEFAULT_PIPELINE, OrderRecord, OrderResponse } from '@marketplace/contracts';

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

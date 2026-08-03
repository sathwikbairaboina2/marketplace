import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export const PROBLEM_SCHEMA_NAME = 'Problem';

/**
 * The RFC 9457 problem body every `ProblemFilter` in both services writes to
 * the wire (see `apps/engine/src/common/problem.ts` / `problem.filter.ts`,
 * mirrored in agents).
 *
 * `instance` and `traceId` are documented explicitly because the filter adds
 * them to every response it writes, not just some. They stay out of `required`
 * so this schema keeps describing exactly what RFC 9457 itself mandates.
 *
 * `additionalProperties: true` covers the per-type `extra` fields
 * `ProblemException` accepts -- for example the `errors[]` array
 * `ZodValidationPipe` attaches to a 400.
 */
export const ProblemSchema: SchemaObject = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'number' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    traceId: { type: 'string' },
  },
  required: ['type', 'title', 'status'],
  additionalProperties: true,
};

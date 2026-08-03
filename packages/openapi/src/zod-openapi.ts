import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodSchema } from 'zod';
// `SchemaObject` is not re-exported from the package root -- @nestjs/swagger's
// `interfaces` barrel only forwards `ApiTagOptions` and `OpenAPIObject` -- so it
// comes from the interface module directly. This is a type-only import, erased
// at emit, and `moduleResolution: "node"` resolves the path without consulting
// the package's `exports` map.
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * Converts a Zod schema into an inline OpenAPI 3 schema object. Schemas are
 * inlined ($refStrategy: 'none') rather than collected into a `components`
 * graph: for a browsable local docs page an inline schema reads better and
 * avoids an entire class of component-naming collisions.
 *
 * `.strict()` becomes `additionalProperties: false`; `.default()` values
 * survive into the schema (as `default`) and are excluded from `required`,
 * so Swagger UI's "Try it out" pre-fills a body that already passes
 * `ZodValidationPipe`.
 */
// zodToJsonSchema's return type is a conditional over its `Target` generic that
// resolves into the recursive `JsonSchema7Type`. Calling it generically makes
// `tsc --declaration` give up with TS2589 ("type instantiation is excessively
// deep") while ts-jest, which emits no declarations, compiles it fine. Pinning
// the call behind this narrow signature stops the compiler instantiating that
// conditional at all; the runtime function is unchanged.
type ConvertToOpenApi3 = (
  schema: ZodSchema,
  options: { target: 'openApi3'; $refStrategy: 'none' },
) => SchemaObject;

const convert = zodToJsonSchema as unknown as ConvertToOpenApi3;

export function toOpenApi(schema: ZodSchema): SchemaObject {
  return convert(schema, { target: 'openApi3', $refStrategy: 'none' });
}

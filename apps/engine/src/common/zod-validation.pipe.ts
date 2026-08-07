import { ArgumentMetadata, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { toOpenApi } from '@marketplace/openapi';
import { ZodSchema } from 'zod';
import { ProblemException } from './problem';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ProblemException('invalid-request', 400, 'Request body is invalid', undefined, {
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

// `Body(...)` is a parameter decorator, invoked as `(target, key, index)`.
// `ApiBody(...)` is a method decorator that reads `descriptor.value`.
// `applyDecorators` cannot compose them: it would hand `ApiBody` a parameter
// index where it expects a descriptor and throw at class-definition time.
// This decorator applies `ApiBody` itself, against the descriptor it looks
// up from the prototype -- methods are installed on the prototype before
// member decorators run, so it is present.
export const ZodBody = (schema: ZodSchema): ParameterDecorator => {
  const body = Body(new ZodValidationPipe(schema));
  return (target, key, index) => {
    body(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) ApiBody({ schema: toOpenApi(schema) })(target, key, descriptor);
  };
};

// Same shape as ZodBody, but emits one ApiQuery per top-level key of the
// converted schema, carrying that key's schema and whether it is required.
export const ZodQuery = (schema: ZodSchema): ParameterDecorator => {
  const query = Query(new ZodValidationPipe(schema));
  return (target, key, index) => {
    query(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) return;

    const converted = toOpenApi(schema) as unknown as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    const required = new Set(converted.required ?? []);
    for (const [name, propertySchema] of Object.entries(converted.properties ?? {})) {
      ApiQuery({ name, required: required.has(name), schema: propertySchema })(target, key, descriptor);
    }
  };
};

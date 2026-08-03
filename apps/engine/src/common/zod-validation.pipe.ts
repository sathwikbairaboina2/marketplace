import { ArgumentMetadata, Body, PipeTransform, Query } from '@nestjs/common';
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

export const ZodBody = (schema: ZodSchema): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

export const ZodQuery = (schema: ZodSchema): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));

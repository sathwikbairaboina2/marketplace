import 'reflect-metadata';
import { Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { ZodBody, ZodQuery } from './zod-validation.pipe';

const BodySchema = z.object({ name: z.string().min(1), nickname: z.string().optional() }).strict();
const QuerySchema = z.object({ limit: z.coerce.number().int().default(25), cursor: z.string().optional() });

@Controller('widgets')
class WidgetsController {
  @Post()
  create(@ZodBody(BodySchema) body: z.infer<typeof BodySchema>): { name: string } {
    return { name: body.name };
  }

  @Get()
  list(@ZodQuery(QuerySchema) query: z.infer<typeof QuerySchema>): { limit: number } {
    return { limit: query.limit };
  }
}

@Module({ controllers: [WidgetsController] })
class TestAppModule {}

describe('ZodBody / ZodQuery OpenAPI documentation', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents the ZodBody schema as the request body, defaults absent from required', () => {
    const requestBody = document.paths['/widgets'].post!.requestBody as {
      content: { 'application/json': { schema: Record<string, any> } };
    };
    const schema = requestBody.content['application/json'].schema;
    expect(schema.required).toEqual(['name']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('documents each ZodQuery top-level key as its own query parameter, with required-ness', () => {
    const params = document.paths['/widgets'].get!.parameters as Array<{ name: string; required?: boolean }>;
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['cursor', 'limit']);
    expect(byName.limit.required).toBeFalsy();
    expect(byName.cursor.required).toBeFalsy();
  });
});

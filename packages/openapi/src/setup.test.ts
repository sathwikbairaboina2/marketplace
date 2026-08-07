import 'reflect-metadata';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { ApiOperation, OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { setupOpenApi } from './setup';
import { PROBLEM_SCHEMA_NAME } from './problem';

@Controller('widgets')
class WidgetsController {
  @Get()
  list(): string[] {
    return [];
  }
}

@Controller('health')
class HealthController {
  @ApiOperation({ security: [] })
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [WidgetsController, HealthController] })
class TestAppModule {}

describe('setupOpenApi', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = setupOpenApi(app, { title: 'Test', version: '1.0.0' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a bearer http security scheme named "bearer"', () => {
    expect(document.components?.securitySchemes?.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('sets a global security requirement', () => {
    expect(document.security).toEqual([{ bearer: [] }]);
  });

  it('registers the Problem schema as a reusable component', () => {
    expect(document.components?.schemas?.[PROBLEM_SCHEMA_NAME]).toBeDefined();
  });

  it('adds a default problem response to every operation', () => {
    const op = document.paths['/widgets'].get!;
    expect(op.responses.default).toMatchObject({
      content: {
        'application/problem+json': {
          schema: { $ref: `#/components/schemas/${PROBLEM_SCHEMA_NAME}` },
        },
      },
    });
  });

  it('adds a 401 problem response to an operation that kept the global security requirement', () => {
    const op = document.paths['/widgets'].get!;
    expect(op.responses['401']).toBeDefined();
  });

  it('does not add a 401 response to an operation with an empty security requirement', () => {
    const op = document.paths['/health/live'].get!;
    expect(op.responses['401']).toBeUndefined();
  });
});

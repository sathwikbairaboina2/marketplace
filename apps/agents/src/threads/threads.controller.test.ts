import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ThreadsController } from './threads.controller';
import { ThreadRegistryService } from './thread-registry.service';
import { GraphService } from '../graph/graph.service';

@Module({
  controllers: [ThreadsController],
  providers: [
    { provide: ThreadRegistryService, useValue: {} },
    { provide: GraphService, useValue: {} },
  ],
})
class TestAppModule {}

describe('ThreadsController OpenAPI documentation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents the 200 response with the AgentStateSnapshot schema', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    // Double assertion: the declared type is `ResponseObject | ReferenceObject`,
    // and a `$ref` response carries no `content`, so TypeScript rejects the
    // direct cast. The assertion below is what the test is asserting about.
    const ok = document.paths['/threads/{id}'].get!.responses['200'] as unknown as {
      content: { 'application/json': { schema: Record<string, any> } };
    };
    const schema = ok.content['application/json'].schema;
    expect(schema.properties).toHaveProperty('threadId');
    expect(schema.properties).toHaveProperty('phase');
    expect(schema.properties).toHaveProperty('messages');
    expect(schema.properties).toHaveProperty('dispatchedMessageId');
  });
});

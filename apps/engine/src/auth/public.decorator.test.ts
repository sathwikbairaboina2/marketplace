import 'reflect-metadata';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC, Public } from './public.decorator';

@Controller('widgets')
class WidgetsController {
  @Public()
  @Get('open')
  open(): string {
    return 'ok';
  }

  @Get('closed')
  closed(): string {
    return 'ok';
  }
}

@Module({ controllers: [WidgetsController] })
class TestAppModule {}

describe('Public()', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('still sets the isPublic reflector metadata the guard reads', () => {
    const reflector = new Reflector();
    const instance = app.get(WidgetsController);
    expect(reflector.get<boolean>(IS_PUBLIC, instance.open)).toBe(true);
    expect(reflector.get<boolean>(IS_PUBLIC, instance.closed)).toBeUndefined();
  });

  it('overrides the global security requirement with an empty array in the OpenAPI document', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    expect(document.paths['/widgets/open'].get!.security).toEqual([]);
    expect(document.paths['/widgets/closed'].get!.security).toBeUndefined();
  });
});

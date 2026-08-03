import { Global, Module } from '@nestjs/common';
import { RegistryController } from './registry.controller';
import { SchemaRegistryService } from './schema-registry.service';

@Global()
@Module({
  controllers: [RegistryController],
  providers: [SchemaRegistryService],
  exports: [SchemaRegistryService],
})
export class RegistryModule {}

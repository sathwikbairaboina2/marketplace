import { Global, Module } from '@nestjs/common';
import { SchemaRegistryService } from './schema-registry.service';

@Global()
@Module({ providers: [SchemaRegistryService], exports: [SchemaRegistryService] })
export class RegistryModule {}

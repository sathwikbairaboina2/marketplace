import { Controller, Get, Param } from '@nestjs/common';
import {
  DynamicEntityType,
  DynamicEntityTypeSchema,
  FieldDefinition,
} from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { SchemaRegistryService } from './schema-registry.service';

interface SchemaView {
  entityType: DynamicEntityType;
  version: number;
  fields: Record<string, FieldDefinition>;
}

@Controller('schemas')
export class RegistryController {
  constructor(private readonly registry: SchemaRegistryService) {}

  @Get()
  async list(): Promise<{ items: SchemaView[] }> {
    const items = await Promise.all(
      DynamicEntityTypeSchema.options.map((entityType) => this.one(entityType)),
    );
    return { items };
  }

  @Get(':entityType')
  async get(@Param('entityType') entityType: string): Promise<SchemaView> {
    const parsed = DynamicEntityTypeSchema.safeParse(entityType);
    if (!parsed.success) {
      // Not 400: from the caller's perspective there is no such schema resource.
      throw new ProblemException(
        'not-found',
        404,
        'No such schema',
        `${entityType} is not a dynamic entity type`,
      );
    }
    return this.one(parsed.data);
  }

  private async one(entityType: DynamicEntityType): Promise<SchemaView> {
    const { version, fields } = await this.registry.get(entityType);
    return { entityType, version, fields };
  }
}

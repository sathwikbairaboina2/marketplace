import { Inject, Injectable } from '@nestjs/common';
import {
  DynamicEntityType,
  EntitySchemaRecord,
  EntitySchemaRecordSchema,
} from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';

@Injectable()
export class EngineClient {
  constructor(@Inject(ENV) private readonly env: EnvConfig) {}

  async getSchema(entityType: DynamicEntityType, token: string): Promise<EntitySchemaRecord> {
    const body = await this.get(`/api/v1/schemas/${entityType}`, token);
    // The Engine returns { entityType, version, fields }; the graph only needs
    // the record shape the registry contract already describes.
    return EntitySchemaRecordSchema.parse({ version: body.version, fields: body.fields });
  }

  private async get(path: string, token: string): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await fetch(`${this.env.ENGINE_BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.env.ENGINE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ProblemException(
        'engine-unavailable',
        503,
        'Engine is unreachable',
        (err as Error).message,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProblemException('unauthorized', 401, 'Engine rejected the caller token');
    }
    if (res.status === 404) {
      throw new ProblemException('not-found', 404, 'Engine has no such resource', path);
    }
    if (!res.ok) {
      // 5xx is the Engine failing, not the caller. Same recovery as unreachable.
      throw new ProblemException(
        'engine-unavailable',
        503,
        'Engine returned an error',
        `${res.status} for ${path}`,
      );
    }

    return (await res.json()) as Record<string, any>;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import {
  DynamicEntityType,
  EntitySchemaRecord,
  EntitySchemaRecordSchema,
  StorefrontConfig,
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

  /** The onboarding graph's one write: the whole draft, with the owner's token. */
  async putStorefrontDraft(config: StorefrontConfig, token: string): Promise<void> {
    await this.send('PUT', '/api/v1/storefront/draft', token, config);
  }

  /**
   * The caller's own orders, newest first, with the caller's token -- the
   * engine's per-user scoping does the isolation, and this service never
   * holds a broader credential than the person asking.
   */
  async listOrders(token: string): Promise<Array<Record<string, any>>> {
    const body = await this.get('/api/v1/orders?limit=25', token);
    return (body.items ?? []) as Array<Record<string, any>>;
  }

  private get(path: string, token: string): Promise<Record<string, any>> {
    return this.send('GET', path, token);
  }

  private async send(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await fetch(`${this.env.ENGINE_BASE_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    // A 400 is this service sending a payload the Engine's contract rejects --
    // the caller's payload was already validated, so surface it as our bug,
    // distinct from the Engine being down.
    if (res.status === 400) {
      throw new ProblemException('invalid-request', 400, 'Engine rejected the payload', path);
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

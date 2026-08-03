import { Controller, Get, Inject } from '@nestjs/common';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  private readonly ddb: DynamoDBClient;
  private readonly redis: Redis;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.ddb = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT });
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{ dynamodb: string; redis: string }> {
    await this.ddb.send(new DescribeTableCommand({ TableName: this.env.TABLE_NAME }));
    // `lazyConnect: true` means the client only connects on first use, so the first poll must
    // call `connect()` itself. Every poll after that must NOT: ioredis throws "Redis is already
    // connecting/connected" if `connect()` is called again on an already-connected client, and
    // the old unconditional `.catch(() => undefined)` swallowed that error unconditionally --
    // which also swallowed a genuine reconnect failure on the same line, hiding it behind a
    // response that still went on to attempt `ping()`. Only call `connect()` when the client is
    // in a state where it genuinely needs to (re)connect.
    if (!['connect', 'connecting', 'ready'].includes(this.redis.status)) {
      await this.redis.connect();
    }
    await this.redis.ping();
    return { dynamodb: 'ok', redis: 'ok' };
  }
}

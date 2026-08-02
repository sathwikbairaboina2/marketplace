import { Controller, Get, Inject } from '@nestjs/common';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';

@Controller('health')
export class HealthController {
  private readonly ddb: DynamoDBClient;
  private readonly redis: Redis;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.ddb = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT });
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ dynamodb: string; redis: string }> {
    await this.ddb.send(new DescribeTableCommand({ TableName: this.env.TABLE_NAME }));
    await this.redis.connect().catch(() => undefined);
    await this.redis.ping();
    return { dynamodb: 'ok', redis: 'ok' };
  }
}

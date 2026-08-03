import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './health/health.module';
import { EngineClientModule } from './engine-client/engine-client.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { GraphModule } from './graph/graph.module';
import { AuthModule } from './auth/auth.module';
import { ThreadsModule } from './threads/threads.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
      },
    }),
    ConfigModule,
    RedisModule,
    LlmModule,
    EngineClientModule,
    DispatchModule,
    GraphModule,
    HealthModule,
    AuthModule,
    ThreadsModule,
    ChatModule,
  ],
})
export class AppModule {}

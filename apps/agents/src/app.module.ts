import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DevTokenModule } from '@marketplace/openapi';
import { ConfigModule } from './config/config.module';
import { loggerOptions } from './config/logger.options';
import { DevTokenEnvSchema } from './config/env.schema';
import { RedisModule } from './redis/redis.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './health/health.module';
import { EngineClientModule } from './engine-client/engine-client.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { GraphModule } from './graph/graph.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { CopywriterModule } from './copywriter/copywriter.module';
import { SupportModule } from './support/support.module';
import { SetupPlanModule } from './setup-plan/setup-plan.module';
import { AuthModule } from './auth/auth.module';
import { ThreadsModule } from './threads/threads.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        ...loggerOptions,
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
      },
    }),
    ConfigModule,
    DevTokenModule.registerIfEnabled(DevTokenEnvSchema.parse(process.env)),
    RedisModule,
    LlmModule,
    EngineClientModule,
    DispatchModule,
    GraphModule,
    OnboardingModule,
    CopywriterModule,
    SupportModule,
    SetupPlanModule,
    HealthModule,
    AuthModule,
    ThreadsModule,
    ChatModule,
  ],
})
export class AppModule {}

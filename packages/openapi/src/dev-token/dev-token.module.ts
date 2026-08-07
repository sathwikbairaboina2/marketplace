import { DynamicModule, Module } from '@nestjs/common';
import { DEV_TOKEN_ENV, DevTokenEnv } from './dev-token.env';
import { DevTokenController } from './dev-token.controller';
import { DevTokenService } from './dev-token.service';

@Module({})
export class DevTokenModule {
  /**
   * Returns a module with no controller and no providers unless both
   * `env.DOCS_ENABLED` is true and `env.COGNITO_ENDPOINT` is set. In a
   * deployed build the route does not exist -- it is not registered, so it
   * 404s from the router, rather than existing and refusing.
   */
  static registerIfEnabled(env: DevTokenEnv): DynamicModule {
    if (!env.DOCS_ENABLED || !env.COGNITO_ENDPOINT) {
      return { module: DevTokenModule };
    }

    return {
      module: DevTokenModule,
      controllers: [DevTokenController],
      providers: [{ provide: DEV_TOKEN_ENV, useValue: env }, DevTokenService],
    };
  }
}

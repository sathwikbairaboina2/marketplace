import 'reflect-metadata';
import { DevTokenModule } from './dev-token.module';
import { DevTokenController } from './dev-token.controller';

const BASE_ENV = {
  DEV_TENANT_ID: 'tenant-dev',
  DEV_USERNAME: 'dev@marketplace.local',
  AWS_REGION: 'us-east-1',
};

describe('DevTokenModule.registerIfEnabled', () => {
  it('contributes no controller when DOCS_ENABLED is false', () => {
    const mod = DevTokenModule.registerIfEnabled({
      ...BASE_ENV,
      DOCS_ENABLED: false,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
    });
    expect(mod.controllers ?? []).toHaveLength(0);
    expect(mod.providers ?? []).toHaveLength(0);
  });

  it('contributes no controller when COGNITO_ENDPOINT is unset', () => {
    const mod = DevTokenModule.registerIfEnabled({ ...BASE_ENV, DOCS_ENABLED: true });
    expect(mod.controllers ?? []).toHaveLength(0);
    expect(mod.providers ?? []).toHaveLength(0);
  });

  it('registers DevTokenController when both DOCS_ENABLED and COGNITO_ENDPOINT are set', () => {
    const mod = DevTokenModule.registerIfEnabled({
      ...BASE_ENV,
      DOCS_ENABLED: true,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
    });
    expect(mod.controllers).toEqual([DevTokenController]);
    expect(mod.providers).toBeDefined();
  });
});

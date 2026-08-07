export const DEV_TOKEN_ENV = Symbol('DEV_TOKEN_ENV');

export interface DevTokenEnv {
  DOCS_ENABLED: boolean;
  DEV_TENANT_ID: string;
  DEV_USERNAME: string;
  AWS_REGION: string;
  COGNITO_ENDPOINT?: string;
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
}

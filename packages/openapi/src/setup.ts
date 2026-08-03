import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PROBLEM_SCHEMA_NAME, ProblemSchema } from './problem';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;

const PROBLEM_JSON_RESPONSE = {
  description: 'A problem detail, per RFC 9457.',
  content: {
    'application/problem+json': {
      schema: { $ref: `#/components/schemas/${PROBLEM_SCHEMA_NAME}` },
    },
  },
};

// Waits for Swagger UI to attach `window.ui`, then mints a dev token from
// this same origin's gated `POST ../dev/token` and pre-authorizes it, so
// "Try it out" works without a manual copy-paste. Failure -- flag off,
// Cognito down, the dev-token package missing -- is non-fatal by
// construction: it logs to the console and leaves the Authorize button
// working normally. `../dev/token` is relative to the docs path
// (`api/v1/docs`), landing on `api/v1/dev/token` on the same origin, so no
// CORS configuration is involved.
const customJsStr = `
(function () {
  function waitForUi() {
    if (window.ui) {
      fetch('../dev/token', { method: 'POST' })
        .then(function (res) {
          if (!res.ok) throw new Error('dev token request failed: ' + res.status);
          return res.json();
        })
        .then(function (body) {
          window.ui.preauthorizeApiKey('bearer', body.token);
        })
        .catch(function (err) {
          console.log('OpenAPI dev-token pre-fill skipped:', err);
        });
      return;
    }
    setTimeout(waitForUi, 100);
  }
  waitForUi();
})();
`;

export interface SetupOpenApiOptions {
  title: string;
  version: string;
}

/**
 * Builds the OpenAPI document from the running Nest application, registers a
 * global bearer security requirement, injects a shared `default`/`401`
 * problem response on every operation, and serves Swagger UI at
 * `api/v1/docs` (the JSON document is served at `api/v1/docs-json` by
 * `@nestjs/swagger`'s own convention). Call only when `DOCS_ENABLED` is true,
 * after `setGlobalPrefix('api/v1')` and before `app.listen(...)`.
 */
export function setupOpenApi(app: INestApplication, options: SetupOpenApiOptions): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setVersion(options.version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // An empty operation-level `security` array (set by `Public()`) overrides
  // this global requirement for that operation; @nestjs/swagger and the
  // OpenAPI 3 spec both treat operation-level `security` as a full override,
  // never a merge.
  document.security = [{ bearer: [] }];

  document.components = document.components ?? {};
  document.components.schemas = {
    ...(document.components.schemas ?? {}),
    [PROBLEM_SCHEMA_NAME]: ProblemSchema,
  };

  for (const pathItem of Object.values(document.paths ?? {})) {
    const operations = pathItem as Record<
      string,
      { security?: unknown[]; responses?: Record<string, unknown> } | undefined
    >;
    for (const method of HTTP_METHODS) {
      const operation = operations[method];
      if (!operation) continue;

      operation.responses = { ...operation.responses, default: PROBLEM_JSON_RESPONSE };

      const isPublic = Array.isArray(operation.security) && operation.security.length === 0;
      if (!isPublic) {
        operation.responses['401'] = PROBLEM_JSON_RESPONSE;
      }
    }
  }

  SwaggerModule.setup('api/v1/docs', app, document, {
    customJsStr,
    swaggerOptions: { persistAuthorization: true },
  });

  return document;
}

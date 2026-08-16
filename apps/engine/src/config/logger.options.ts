import type { Options } from 'pino-http';

/**
 * Everything the logger must never write down.
 *
 * pino-http serializes request and response headers wholesale, so before this
 * existed every single request produced a log line containing the caller's
 * complete bearer token -- valid until it expired, and replayable by anyone
 * who could read a log aggregator, a support bundle, or a screenshot of a
 * terminal. Found by reading `docker compose logs engine` while debugging
 * something else entirely.
 *
 * Redacted rather than removed: that a request carried an `authorization`
 * header is worth knowing when reading logs; its value is not.
 *
 * Typed against `pino-http` rather than `pino` deliberately -- `pino` is a
 * transitive dependency here, and importing it directly would work only by
 * accident of hoisting.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACTED_PATHS, censor: '[Redacted]' },
} satisfies Options;

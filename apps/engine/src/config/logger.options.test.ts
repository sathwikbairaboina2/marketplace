import { pinoHttp } from 'pino-http';
import { loggerOptions } from './logger.options';

/**
 * The bearer token is the whole session.
 *
 * pino-http serializes every request header by default, so each request
 * produced a log line carrying a complete, still-valid JWT -- replayable by
 * anyone who can read a log aggregator, a support bundle, or a screenshot,
 * for as long as the token lives.
 */
function captureLog(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  // The same options the app hands pino-http, driving a real pino instance --
  // asserting on the bytes that would reach a log file, not on the config.
  const { logger } = pinoHttp(loggerOptions, { write: (line: string) => lines.push(line) });
  logger.info(payload, 'request completed');
  return lines.join('');
}

describe('loggerOptions', () => {
  it('does not write the bearer token to the log', () => {
    const line = captureLog({
      req: { headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.secret-payload.signature' } },
    });

    expect(line).not.toContain('secret-payload');
    expect(line).not.toContain('Bearer ');
  });

  it('says the header was there rather than dropping it silently', () => {
    const line = captureLog({ req: { headers: { authorization: 'Bearer abc' } } });

    // Knowing a request *was* authenticated is useful when reading logs; the
    // value is what must not survive.
    expect(line).toContain('authorization');
    expect(line).toContain('[Redacted]');
  });

  it('redacts a cookie header too', () => {
    const line = captureLog({ req: { headers: { cookie: 'session=super-secret' } } });

    expect(line).not.toContain('super-secret');
  });

  it('redacts a set-cookie response header', () => {
    const line = captureLog({ res: { headers: { 'set-cookie': 'session=super-secret' } } });

    expect(line).not.toContain('super-secret');
  });

  it('leaves ordinary headers legible', () => {
    const line = captureLog({ req: { headers: { authorization: 'Bearer abc', host: 'localhost:3000' } } });

    expect(line).toContain('localhost:3000');
  });

  it('keeps the rest of the line intact', () => {
    const line = captureLog({
      req: { method: 'GET', url: '/api/v1/products', headers: { authorization: 'Bearer abc' } },
    });

    expect(line).toContain('/api/v1/products');
    expect(line).toContain('GET');
  });
});

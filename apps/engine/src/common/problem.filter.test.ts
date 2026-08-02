import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { ProblemFilter } from './problem.filter';

// The filter logs 5xx problems via `Logger.error`. Silence stdout for these
// assertions — the live-stack pino log line is the evidence of record for
// what the emitted log entry actually contains (see task-8-report.md).
let loggerErrorSpy: jest.SpyInstance;
beforeEach(() => {
  loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  loggerErrorSpy.mockRestore();
});

function fakeHost(req: Record<string, unknown>): {
  host: ArgumentsHost;
  getStatus: jest.Mock;
  getType: jest.Mock;
  getJson: jest.Mock;
} {
  const getJson = jest.fn();
  const getType = jest.fn().mockReturnThis();
  const getStatus = jest.fn().mockReturnThis();
  const res = {
    status: getStatus,
    type: getType,
    json: getJson,
  };
  // status/type must return `this` (the res mock) so `.type(...).json(...)` chains work
  getStatus.mockReturnValue(res);
  getType.mockReturnValue(res);

  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;

  return { host, getStatus, getType, getJson };
}

describe('ProblemFilter', () => {
  it('never leaks a 5xx HttpException message into the response body', () => {
    const filter = new ProblemFilter();
    const secret = 'connection string: postgres://admin:hunter2@internal-db/prod';
    const exception = new HttpException(secret, 500);
    const { host, getStatus, getJson } = fakeHost({ headers: {}, originalUrl: '/api/v1/boom' });

    filter.catch(exception, host);

    expect(getStatus).toHaveBeenCalledWith(500);
    const body = getJson.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(body).toMatchObject({
      type: 'https://marketplace.local/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
    });
    expect(body.detail).toBeUndefined();
  });

  it('sources traceId from the pino-assigned req.id, not the raw incoming header', () => {
    const filter = new ProblemFilter();
    const exception = new HttpException('nope', 401);
    const { host, getJson } = fakeHost({
      id: 'pino-generated-uuid',
      headers: { 'x-request-id': 'client-sent-value' },
      originalUrl: '/api/v1/me',
    });

    filter.catch(exception, host);

    const body = getJson.mock.calls[0][0];
    expect(body.traceId).toBe('pino-generated-uuid');
  });

  it('falls back to the incoming header, then "unknown", when req.id is absent', () => {
    const filter = new ProblemFilter();
    const { host, getJson } = fakeHost({
      headers: { 'x-request-id': 'header-value' },
      originalUrl: '/api/v1/me',
    });
    filter.catch(new HttpException('nope', 401), host);
    expect(getJson.mock.calls[0][0].traceId).toBe('header-value');

    const { host: host2, getJson: getJson2 } = fakeHost({ headers: {}, originalUrl: '/api/v1/me' });
    filter.catch(new HttpException('nope', 401), host2);
    expect(getJson2.mock.calls[0][0].traceId).toBe('unknown');
  });
});

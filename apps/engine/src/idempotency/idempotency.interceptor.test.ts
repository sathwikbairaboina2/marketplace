import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor, IDEMPOTENT_REPLAY_HEADER } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';
import { ProblemException } from '../common/problem';
import { runWithTenant } from '../common/tenant-context';

function makeContext(headers: Record<string, string>) {
  const setHeader = jest.fn();
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId: 'tenant_a', userId: 'user-1', role: null }, fn);

describe('IdempotencyInterceptor', () => {
  it('passes straight through when no Idempotency-Key header is present', async () => {
    const service = { begin: jest.fn(), complete: jest.fn(), release: jest.fn() };
    const interceptor = new IdempotencyInterceptor(service as unknown as IdempotencyService);
    const { context } = makeContext({});
    const handle = jest.fn(() => of({ untouched: true }));
    const next: CallHandler = { handle };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({ untouched: true });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(service.begin).not.toHaveBeenCalled();
  });

  it('claims a fresh key, runs the handler, and persists the response before emitting it', async () => {
    const order: string[] = [];
    const service = {
      begin: jest.fn().mockResolvedValue({ status: 'new' }),
      complete: jest.fn().mockImplementation(async () => {
        order.push('complete');
      }),
      release: jest.fn(),
    };
    const interceptor = new IdempotencyInterceptor(service as unknown as IdempotencyService);
    const { context } = makeContext({ 'idempotency-key': 'key-1' });
    const handle = jest.fn(() => of({ id: 'ORDER-1' }));
    const next: CallHandler = { handle };

    const result = await asTenant(() => lastValueFrom(interceptor.intercept(context, next)));
    order.push('emitted');

    expect(result).toEqual({ id: 'ORDER-1' });
    expect(service.complete).toHaveBeenCalledWith('key-1', { id: 'ORDER-1' });
    // complete() must finish before the response reaches the subscriber, not
    // fire-and-forget in the background.
    expect(order).toEqual(['complete', 'emitted']);
  });

  it('replays a completed response without invoking the handler again and flags the response as a replay', async () => {
    const service = {
      begin: jest.fn().mockResolvedValue({ status: 'replay', response: { id: 'ORDER-1' } }),
      complete: jest.fn(),
      release: jest.fn(),
    };
    const interceptor = new IdempotencyInterceptor(service as unknown as IdempotencyService);
    const { context, setHeader } = makeContext({ 'idempotency-key': 'key-1' });
    const handle = jest.fn(() => of({ id: 'SHOULD-NOT-RUN' }));
    const next: CallHandler = { handle };

    const result = await asTenant(() => lastValueFrom(interceptor.intercept(context, next)));

    expect(result).toEqual({ id: 'ORDER-1' });
    expect(handle).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(IDEMPOTENT_REPLAY_HEADER, 'true');
  });

  it('raises request-in-progress (409) for a claimed but unfinished key', async () => {
    const service = {
      begin: jest.fn().mockRejectedValue(
        new ProblemException('request-in-progress', 409, 'Request in progress', 'still processing'),
      ),
      complete: jest.fn(),
      release: jest.fn(),
    };
    const interceptor = new IdempotencyInterceptor(service as unknown as IdempotencyService);
    const { context } = makeContext({ 'idempotency-key': 'key-1' });
    const next: CallHandler = { handle: jest.fn(() => of({})) };

    await expect(asTenant(() => lastValueFrom(interceptor.intercept(context, next)))).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('releases the claim and still propagates the error when the handler throws', async () => {
    const service = {
      begin: jest.fn().mockResolvedValue({ status: 'new' }),
      complete: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const interceptor = new IdempotencyInterceptor(service as unknown as IdempotencyService);
    const { context } = makeContext({ 'idempotency-key': 'key-1' });
    const failure = new Error('boom');
    const next: CallHandler = { handle: jest.fn(() => throwError(() => failure)) };

    await expect(asTenant(() => lastValueFrom(interceptor.intercept(context, next)))).rejects.toBe(failure);

    expect(service.release).toHaveBeenCalledWith('key-1');
    expect(service.complete).not.toHaveBeenCalled();
  });
});

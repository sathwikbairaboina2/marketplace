import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth, getToken } from './auth-context';

function Probe() {
  const { principal, signIn, ready } = useAuth();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="tenant">{principal?.tenantId ?? 'none'}</span>
      <button onClick={() => void signIn('acme-admin', 'Passw0rd!')}>in</button>
    </div>
  );
}

const principalResponse = (tenantId: string) =>
  new Response(JSON.stringify({ tenantId, userId: 'u1', role: 'admin' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('AuthProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores the token and principal after a successful sign in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/login')) {
          return new Response(JSON.stringify({ token: 'tok-123' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return principalResponse('acme');
      }),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('in').click();
    });

    expect(screen.getByTestId('tenant')).toHaveTextContent('acme');
    expect(sessionStorage.getItem('marketplace.token')).toBe('tok-123');
    expect(getToken()).toBe('tok-123');
  });

  it('rehydrates a token from sessionStorage on mount', async () => {
    sessionStorage.setItem('marketplace.token', 'tok-existing');
    vi.stubGlobal('fetch', vi.fn(async () => principalResponse('globex')));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('tenant')).toHaveTextContent('globex');
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });

  // A token can outlive the pool that minted it: `docker:up` drops the
  // cognito-data volume and creates a brand new user pool. Validating on mount
  // is what sends a stale session to /login instead of failing on the first
  // data call with a confusing 401.
  it('discards a stored token the engine rejects', async () => {
    sessionStorage.setItem('marketplace.token', 'tok-stale');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('tenant')).toHaveTextContent('none');
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
    expect(sessionStorage.getItem('marketplace.token')).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('surfaces the detail from a rejected sign in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'invalid credentials' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    let captured: Error | null = null;
    function Failing() {
      const { signIn } = useAuth();
      return (
        <button
          onClick={() => {
            void signIn('nobody', 'wrong').catch((err: Error) => {
              captured = err;
            });
          }}
        >
          go
        </button>
      );
    }

    render(
      <AuthProvider>
        <Failing />
      </AuthProvider>,
    );
    await act(async () => {
      screen.getByText('go').click();
    });

    expect(captured).not.toBeNull();
    expect((captured as unknown as Error).message).toBe('invalid credentials');
  });
});

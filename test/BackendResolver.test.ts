import { resolveBackend, resolveBackendForTrigger } from '../shared/backends/BackendResolver';

function fakeExecuteCtx(opts: {
  credentials?: Record<string, unknown>;
  params?: Record<string, unknown>;
}) {
  return {
    getCredentials: jest.fn().mockResolvedValue(opts.credentials),
    getNodeParameter: jest.fn((name: string, _itemIndex: number, fallback?: unknown) => {
      if (opts.params && name in opts.params) return opts.params[name];
      return fallback;
    }),
  } as never;
}

function fakeTriggerCtx(opts: {
  credentials?: Record<string, unknown>;
  params?: Record<string, unknown>;
}) {
  return {
    getCredentials: jest.fn().mockResolvedValue(opts.credentials),
    getNodeParameter: jest.fn((name: string, fallback?: unknown) => {
      if (opts.params && name in opts.params) return opts.params[name];
      return fallback;
    }),
  } as never;
}

describe('resolveBackend (IExecuteFunctions nodes)', () => {
  it('defaults to legacy when no credential and no override are set', async () => {
    const ctx = fakeExecuteCtx({ credentials: undefined, params: {} });
    const { backendId, sessionId } = await resolveBackend(ctx, 0);
    expect(backendId).toBe('legacy');
    expect(sessionId).toBe('default');
  });

  it('uses the credential backend when override is "useCredential"', async () => {
    const ctx = fakeExecuteCtx({
      credentials: { backend: 'official', sessionId: 'work' },
      params: { backendOverride: 'useCredential', sessionId: 'work' },
    });
    const { backendId, sessionId } = await resolveBackend(ctx, 0);
    expect(backendId).toBe('official');
    expect(sessionId).toBe('work');
  });

  it('node-level override wins over the credential backend', async () => {
    const ctx = fakeExecuteCtx({
      credentials: { backend: 'official' },
      params: { backendOverride: 'legacy' },
    });
    const { backendId } = await resolveBackend(ctx, 0);
    expect(backendId).toBe('legacy');
  });

  it('sanitises the session id (matches pre-upgrade sanitiseSessionId behaviour)', async () => {
    const ctx = fakeExecuteCtx({ params: { sessionId: 'My Session!!' } });
    const { sessionId } = await resolveBackend(ctx, 0);
    expect(sessionId).toBe('my_session__');
  });

  it('tolerates a missing "backendOverride" param (pre-upgrade node instances)', async () => {
    const ctx = {
      getCredentials: jest.fn().mockResolvedValue({ backend: 'legacy' }),
      getNodeParameter: jest.fn((name: string) => {
        if (name === 'backendOverride') throw new Error('param does not exist');
        return 'default';
      }),
    } as never;
    const { backendId } = await resolveBackend(ctx, 0);
    expect(backendId).toBe('legacy');
  });
});

describe('resolveBackendForTrigger (ITriggerFunctions nodes)', () => {
  it('resolves using the 2-arg getNodeParameter signature (no itemIndex)', async () => {
    const ctx = fakeTriggerCtx({
      credentials: { backend: 'legacy', sessionId: 'trigger-session' },
      params: { backendOverride: 'useCredential', sessionId: 'trigger-session' },
    });
    const { backendId, sessionId } = await resolveBackendForTrigger(ctx);
    expect(backendId).toBe('legacy');
    expect(sessionId).toBe('trigger-session');
  });

  it('node override wins for trigger nodes too', async () => {
    const ctx = fakeTriggerCtx({
      credentials: { backend: 'legacy' },
      params: { backendOverride: 'official' },
    });
    const { backendId } = await resolveBackendForTrigger(ctx);
    expect(backendId).toBe('official');
  });
});

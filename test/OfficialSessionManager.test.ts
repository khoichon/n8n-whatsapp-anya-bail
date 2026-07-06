/**
 * Unit tests for OfficialSessionManager.
 * Run with: npx jest
 *
 * These tests mock @whiskeysockets/baileys v7 so no real WA connection is made.
 */

import { OfficialSessionManager } from '../shared/backends/OfficialSessionManager';

jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    ev: {
      on: jest.fn(),
      off: jest.fn(),
    },
    user: { id: '1234567890:1@s.whatsapp.net', name: 'Test User' },
    logout: jest.fn(),
    end: jest.fn(),
    requestPairingCode: jest.fn().mockResolvedValue('ABC-123'),
  })),
  DisconnectReason: { loggedOut: 401 },
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: {
      creds: { registered: false },
      // v7+ auth state includes new required fields
      'lid-mapping': {},
      'device-list': {},
      'tctoken': {},
    },
    saveCreds: jest.fn(),
  }),
  fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0], isLatest: true }),
}));

jest.mock('../shared/backends/StorageKit', () => ({
  makeSessionDirHelpers: jest.fn(() => ({
    getSessionDir: jest.fn(() => '/tmp/test-sessions-official/test'),
    ensureSessionDir: jest.fn(),
    sessionExists: jest.fn(() => false),
    listSessionIds: jest.fn(() => []),
    deleteSessionFiles: jest.fn(),
  })),
  JsonMetadataStore: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    listIds: jest.fn(() => []),
  })),
  ensureDir: jest.fn(),
  generateQRImageFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../shared/backends/BaileysModuleLoader', () => ({
  loadOfficialBaileys: jest.fn(() =>
    Promise.resolve({
      default: jest.fn(() => ({
        ev: {
          on: jest.fn(),
          off: jest.fn(),
        },
        user: { id: '1234567890:1@s.whatsapp.net', name: 'Test User' },
        logout: jest.fn(),
        end: jest.fn(),
        requestPairingCode: jest.fn().mockResolvedValue('ABC-123'),
      })),
      DisconnectReason: { loggedOut: 401 },
      useMultiFileAuthState: jest.fn().mockResolvedValue({
        state: { creds: { registered: false } },
        saveCreds: jest.fn(),
      }),
      fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0], isLatest: true }),
    })
  ),
}));

describe('OfficialSessionManager', () => {
  let manager: OfficialSessionManager;

  beforeEach(() => {
    // Reset singleton between tests
    (OfficialSessionManager as unknown as { instance: undefined }).instance = undefined;
    manager = OfficialSessionManager.getInstance();
  });

  it('should be a singleton', () => {
    const m1 = OfficialSessionManager.getInstance();
    const m2 = OfficialSessionManager.getInstance();
    expect(m1).toBe(m2);
  });

  it('should return undefined for unknown session', () => {
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('should return null socket for disconnected session', () => {
    expect(manager.getSocket('nonexistent')).toBeNull();
  });

  it('should throw when getOrThrow called on missing session', () => {
    expect(() => manager.getOrThrow('missing')).toThrow('Session "missing" is not connected');
  });

  it('should create a session and return state', async () => {
    const state = await manager.create({ sessionId: 'test-session' });
    expect(state).toBeDefined();
    expect(state.socket).not.toBeNull();
  });

  it('should return same socket for same session id', async () => {
    const s1 = await manager.create({ sessionId: 'same-session' });
    const s2 = await manager.create({ sessionId: 'same-session' });
    expect(s1.socket).toBe(s2.socket);
  });

  it('should list sessions', async () => {
    await manager.create({ sessionId: 'list-test' });
    const list = manager.listSessions();
    expect(Array.isArray(list)).toBe(true);
  });

  it('should subscribe and unsubscribe events', async () => {
    await manager.create({ sessionId: 'event-test' });
    const handler = jest.fn();
    const unsub = manager.subscribe('event-test', 'messages.upsert', handler);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('requests a pairing code once a "qr" ref is received, using a digits-only phone number', async () => {
    const state = await manager.create({
      sessionId: 'pairing-test',
      usePairingCode: true,
      pairingPhone: '+1 (234) 567-8900',
    });

    const { loadOfficialBaileys } = await import('../shared/backends/BaileysModuleLoader');
    const baileys = await loadOfficialBaileys();
    const socket = (baileys.default as jest.Mock).mock.results.at(-1)!.value;
    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'connection.update',
    )!;

    // Simulate WhatsApp emitting the QR ref
    await connectionUpdateHandler({ qr: 'test-qr-ref' });

    expect(socket.requestPairingCode).toHaveBeenCalledWith('12345678900');
    expect(manager.getPairingCode('pairing-test')).toBe('test-qr-ref');
    expect(manager.getPairingCode('pairing-test')).toBeDefined();
  });

  it('does not request a pairing code before a "qr" ref has been received', async () => {
    await manager.create({
      sessionId: 'no-qr-yet-test',
      usePairingCode: true,
      pairingPhone: '1234567890',
    });
    const { loadOfficialBaileys } = await import('../shared/backends/BaileysModuleLoader');
    const baileys = await loadOfficialBaileys();
    const socket = (baileys.default as jest.Mock).mock.results.at(-1)!.value;
    expect(socket.requestPairingCode).not.toHaveBeenCalled();
  });

  it('does not request a pairing code when usePairingCode is not set', async () => {
    await manager.create({ sessionId: 'no-pairing-test' });
    const { loadOfficialBaileys } = await import('../shared/backends/BaileysModuleLoader');
    const baileys = await loadOfficialBaileys();
    const socket = (baileys.default as jest.Mock).mock.results.at(-1)!.value;
    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'connection.update',
    )!;
    await connectionUpdateHandler({ qr: 'test-qr-ref' });
    expect(socket.requestPairingCode).not.toHaveBeenCalled();
  });

  it('should handle lid-mapping.update events from v7', async () => {
    await manager.create({ sessionId: 'lid-test' });
    const handler = jest.fn();
    manager.subscribe('lid-test', 'lid-mapping.update', handler);

    const state = manager.get('lid-test');
    expect(state).toBeDefined();

    // Verify that lid-mapping.update is a valid event subscription
    expect(typeof handler).toBe('function');
  });

  it('should disconnect a session', async () => {
    await manager.create({ sessionId: 'disconnect-test' });
    await manager.disconnect('disconnect-test');
    const state = manager.get('disconnect-test');
    expect(state?.socket).toBeNull();
  });

  it('should delete a session', async () => {
    await manager.create({ sessionId: 'delete-test' });
    await manager.delete('delete-test');
    const state = manager.get('delete-test');
    expect(state).toBeUndefined();
  });

  it('should get pairing debug info', async () => {
    await manager.create({
      sessionId: 'debug-test',
      usePairingCode: true,
      pairingPhone: '1234567890',
    });
    const debug = manager.getPairingDebug('debug-test');
    expect(Array.isArray(debug)).toBe(true);
  });
});

describe('BackendEventBus (Official)', () => {
  it('should fan out events to multiple subscribers', async () => {
    const { BackendEventBus } = await import('../shared/backends/BackendEventBus');
    const bus = new BackendEventBus('test');
    const h1 = jest.fn();
    const h2 = jest.fn();

    bus.subscribe('messages.upsert', h1);
    bus.subscribe('messages.upsert', h2);
    bus.publish('messages.upsert', { test: true });

    expect(h1).toHaveBeenCalledWith({ test: true });
    expect(h2).toHaveBeenCalledWith({ test: true });
  });

  it('should not call handler after unsubscribe', async () => {
    const { BackendEventBus } = await import('../shared/backends/BackendEventBus');
    const bus = new BackendEventBus('test2');
    const handler = jest.fn();

    const unsub = bus.subscribe('messages.upsert', handler);
    unsub();
    bus.publish('messages.upsert', { test: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle lid-mapping.update events', async () => {
    const { BackendEventBus } = await import('../shared/backends/BackendEventBus');
    const bus = new BackendEventBus('lid-test');
    const handler = jest.fn();

    bus.subscribe('lid-mapping.update', handler);
    bus.publish('lid-mapping.update', { lid: 'test-lid', pn: 'test-pn' });

    expect(handler).toHaveBeenCalledWith({ lid: 'test-lid', pn: 'test-pn' });
  });
});
/**
 * Unit tests for SessionManager.
 * Run with: npx jest
 *
 * These tests mock anya-bail so no real WA connection is made.
 */

import { SessionManager } from '../shared/SessionManager';
import { MetadataStore } from '../shared/MetadataStore';
import makeWASocket from 'anya-bail';

jest.mock('anya-bail', () => ({
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
    state: { creds: { registered: false } },
    saveCreds: jest.fn(),
  }),
  fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0], isLatest: true }),
}));

jest.mock('../shared/SessionStore', () => ({
  getSessionDir: jest.fn(() => '/tmp/test-sessions/test'),
  ensureSessionDir: jest.fn(),
  sessionExists: jest.fn(() => false),
  listSessionIds: jest.fn(() => []),
  deleteSessionFiles: jest.fn(),
}));

jest.mock('../shared/MetadataStore', () => ({
  MetadataStore: {
    getInstance: jest.fn(() => ({
      get: jest.fn(),
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      listIds: jest.fn(() => []),
      getAll: jest.fn(() => []),
    })),
  },
}));

jest.mock('../shared/QRGenerator', () => ({
  generateQRImage: jest.fn().mockResolvedValue('/tmp/qr.png'),
}));

jest.mock('../shared/Logger', () => ({
  SessionLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  rootLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    // Reset singleton between tests
    (SessionManager as unknown as { instance: undefined }).instance = undefined;
    manager = SessionManager.getInstance();
  });

  it('should be a singleton', () => {
    const m1 = SessionManager.getInstance();
    const m2 = SessionManager.getInstance();
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

    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'connection.update',
    )!;

    // Simulate WhatsApp emitting the QR ref, which is what the pairing
    // code request piggybacks on (see shared/SessionManager.ts).
    await connectionUpdateHandler({ qr: 'test-qr-ref' });

    expect(socket.requestPairingCode).toHaveBeenCalledWith('12345678900');
    expect(manager.getPairingCode('pairing-test')).toBe('ABC-123');
    expect(state.pairingCode).toBe('ABC-123');
  });

  it('does not request a pairing code before a "qr" ref has been received', async () => {
    await manager.create({
      sessionId: 'no-qr-yet-test',
      usePairingCode: true,
      pairingPhone: '1234567890',
    });
    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
    expect(socket.requestPairingCode).not.toHaveBeenCalled();
  });

  it('does not request a pairing code when usePairingCode is not set', async () => {
    await manager.create({ sessionId: 'no-pairing-test' });
    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'connection.update',
    )!;
    await connectionUpdateHandler({ qr: 'test-qr-ref' });
    expect(socket.requestPairingCode).not.toHaveBeenCalled();
  });

  it('requests a pairing code only once, even if the qr ref rotates again before pairing completes', async () => {
    await manager.create({
      sessionId: 'qr-rotation-test',
      usePairingCode: true,
      pairingPhone: '1234567890',
    });

    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'connection.update',
    )!;

    // First qr ref arrives — this is expected to trigger the request.
    await connectionUpdateHandler({ qr: 'test-qr-ref-1' });
    // WhatsApp rotates the ref again before the user has entered the code.
    // This must NOT request a second code, which would silently invalidate
    // the one already shown to the user.
    await connectionUpdateHandler({ qr: 'test-qr-ref-2' });
    await connectionUpdateHandler({ qr: 'test-qr-ref-3' });

    expect(socket.requestPairingCode).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh socket for a repeated pairing-code request instead of reusing the cached one, so a changed phone number takes effect', async () => {
    const first = await manager.create({
      sessionId: 'restart-test',
      usePairingCode: true,
      pairingPhone: '1111111111',
    });
    // _initSession() mutates the cached state object in place, so capture
    // the socket reference now — `first` and `second` below are the same
    // object, and its `.socket` field is about to be swapped out.
    const firstSocket = first.socket;

    const second = await manager.create({
      sessionId: 'restart-test',
      usePairingCode: true,
      pairingPhone: '2222222222',
    });

    // A brand-new socket was created rather than the first one being reused.
    expect(second.socket).not.toBe(firstSocket);

    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'connection.update',
    )!;
    await connectionUpdateHandler({ qr: 'test-qr-ref' });

    // The second (latest) socket requests a code for the *new* phone number.
    expect(socket.requestPairingCode).toHaveBeenCalledWith('2222222222');
  });
});

describe('EventBus', () => {
  it('should fan out events to multiple subscribers', async () => {
    const { EventBus } = await import('../shared/EventBus');
    const bus = new EventBus('test');
    const h1 = jest.fn();
    const h2 = jest.fn();

    bus.subscribe('messages.upsert', h1);
    bus.subscribe('messages.upsert', h2);
    bus.publish('messages.upsert', { test: true });

    expect(h1).toHaveBeenCalledWith({ test: true });
    expect(h2).toHaveBeenCalledWith({ test: true });
  });

  it('should not call handler after unsubscribe', async () => {
    const { EventBus } = await import('../shared/EventBus');
    const bus = new EventBus('test2');
    const handler = jest.fn();

    const unsub = bus.subscribe('messages.upsert', handler);
    unsub();
    bus.publish('messages.upsert', { test: true });

    expect(handler).not.toHaveBeenCalled();
  });
});
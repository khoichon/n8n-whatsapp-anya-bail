/**
 * Unit tests for OfficialBackend.
 * Run with: npx jest
 *
 * These tests test the official Baileys backend adapter.
 */

import { OfficialBackend } from '../shared/backends/OfficialBackend';
import { OFFICIAL_CAPABILITIES } from '../shared/backends/CapabilityRegistry';

jest.mock('../shared/backends/OfficialSessionManager', () => ({
  OfficialSessionManager: {
    getInstance: jest.fn(() => ({
      getSocket: jest.fn(() => ({
        ev: { on: jest.fn(), off: jest.fn() },
        user: { id: '1234567890:1@s.whatsapp.net', name: 'Test User' },
        sendMessage: jest.fn().mockResolvedValue({ key: { id: 'test-msg' } }),
        logout: jest.fn().mockResolvedValue(undefined),
        end: jest.fn(),
      })),
      getOrThrowSocket: jest.fn(() => ({
        sendMessage: jest.fn().mockResolvedValue({ key: { id: 'test-msg' } }),
      })),
      subscribe: jest.fn(() => jest.fn()),
      disconnect: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      listSessions: jest.fn(() => []),
      getQR: jest.fn(() => 'test-qr'),
      getPairingCode: jest.fn(() => 'ABC-123'),
    })),
  },
}));

jest.mock('../shared/backends/BaileysModuleLoader', () => ({
  loadOfficialBaileys: jest.fn(() =>
    Promise.resolve({
      default: jest.fn(),
      DisconnectReason: { loggedOut: 401 },
    })
  ),
}));

describe('OfficialBackend', () => {
  let backend: OfficialBackend;

  beforeEach(() => {
    // Reset singleton between tests
    (OfficialBackend as unknown as { instance: undefined }).instance = undefined;
    backend = OfficialBackend.getInstance();
  });

  it('should be a singleton', () => {
    const b1 = OfficialBackend.getInstance();
    const b2 = OfficialBackend.getInstance();
    expect(b1).toBe(b2);
  });

  it('should have correct backend ID', () => {
    expect(backend.backendId).toBe('official');
  });

  it('should have correct capabilities from OFFICIAL_CAPABILITIES', () => {
    expect(backend.capabilities).toBe(OFFICIAL_CAPABILITIES);
  });

  it('should not claim anya-bail exclusive features', () => {
    expect(backend.capabilities.aiIcon).toBe(false);
    expect(backend.capabilities.tableMessages).toBe(false);
    expect(backend.capabilities.calls).toBe(false);
  });

  it('should support core WhatsApp features', () => {
    expect(backend.capabilities.messages).toBe(true);
    expect(backend.capabilities.media).toBe(true);
    expect(backend.capabilities.polls).toBe(true);
    expect(backend.capabilities.reactions).toBe(true);
    expect(backend.capabilities.groupManagement).toBe(true);
    expect(backend.capabilities.qrLogin).toBe(true);
    expect(backend.capabilities.pairingCode).toBe(true);
  });

  it('should get socket for session', () => {
    const socket = backend.getSocket('test-session');
    expect(socket).toBeDefined();
    expect(socket?.sendMessage).toBeDefined();
  });

  it('should throw when getting socket for non-existent session', () => {
    expect(() => backend.getOrThrowSocket('nonexistent')).toThrow('Session "nonexistent" is not connected');
  });

  it('should get socket for existing session', () => {
    // Mock the session manager to return a socket
    const mockSocket = {
      sendMessage: jest.fn().mockResolvedValue({ key: { id: 'test-msg' } }),
    };

    const { OfficialSessionManager } = require('../shared/backends/OfficialSessionManager');
    OfficialSessionManager.getInstance().getOrThrowSocket = jest.fn(() => mockSocket);

    const socket = backend.getOrThrowSocket('existing-session');
    expect(socket).toBe(mockSocket);
  });

  it('should subscribe to events', () => {
    const handler = jest.fn();
    const unsubscribe = backend.subscribe('test-session', 'messages.upsert', handler);
    expect(typeof unsubscribe).toBe('function');
  });

  it('should disconnect a session', async () => {
    await expect(backend.disconnect('test-session')).resolves.not.toThrow();
  });

  it('should delete a session', async () => {
    await expect(backend.delete('test-session')).resolves.not.toThrow();
  });

  it('should list sessions', () => {
    const sessions = backend.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('should get QR code', () => {
    const qr = backend.getQR('test-session');
    expect(qr).toBeDefined();
  });

  it('should get pairing code', () => {
    const code = backend.getPairingCode('test-session');
    expect(code).toBeDefined();
  });
});
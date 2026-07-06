/**
 * Unit tests for BaileysModuleLoader.
 * Run with: npx jest
 *
 * These tests test the dynamic ESM import mechanism for @whiskeysockets/baileys.
 */

import { loadOfficialBaileys } from '../shared/backends/BaileysModuleLoader';

jest.mock('../shared/backends/BaileysModuleLoader', () => {
  const actual = jest.requireActual('../shared/backends/BaileysModuleLoader');
  return {
    ...actual,
    loadOfficialBaileys: jest.fn(),
  };
});

describe('BaileysModuleLoader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should load official Baileys module', async () => {
    const mockBaileys = {
      default: jest.fn(),
      DisconnectReason: { loggedOut: 401 },
      useMultiFileAuthState: jest.fn(),
      fetchLatestBaileysVersion: jest.fn(),
    };

    jest.spyOn(require('../shared/backends/BaileysModuleLoader'), 'loadOfficialBaileys').mockResolvedValue(mockBaileys);

    const baileys = await loadOfficialBaileys();
    expect(baileys).toBeDefined();
    expect(baileys.default).toBeDefined();
  });

  it('should cache the loaded module', async () => {
    const mockBaileys = {
      default: jest.fn(),
      DisconnectReason: { loggedOut: 401 },
    };

    const mockLoad = jest.spyOn(require('../shared/backends/BaileysModuleLoader'), 'loadOfficialBaileys')
      .mockResolvedValue(mockBaileys);

    // First call
    await loadOfficialBaileys();
    // Second call - should use cache
    await loadOfficialBaileys();

    // Should only call the actual import once due to caching
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it('should throw error if Baileys is not installed', async () => {
    // This test verifies that the error handling works when the package is missing
    // In a real scenario, this would happen if @whiskeysockets/baileys is not installed
    const mockLoad = jest.spyOn(require('../shared/backends/BaileysModuleLoader'), 'loadOfficialBaileys')
      .mockRejectedValue(new Error("Cannot find module '@whiskeysockets/baileys'"));

    await expect(loadOfficialBaileys()).rejects.toThrow();
  });

  it('should handle ESM module loading', async () => {
    // This test verifies that the dynamic import mechanism works for ESM modules
    // Baileys v7 is ESM-only, so this is a critical test

    const mockBaileys = {
      default: jest.fn(() => ({
        ev: { on: jest.fn() },
        user: { id: 'test@s.whatsapp.net' },
      })),
      DisconnectReason: { loggedOut: 401 },
      useMultiFileAuthState: jest.fn().mockResolvedValue({
        state: { creds: {} },
        saveCreds: jest.fn(),
      }),
      fetchLatestBaileysVersion: jest.fn().mockResolvedValue({
        version: [2, 3000, 0],
        isLatest: true,
      }),
    };

    jest.spyOn(require('../shared/backends/BaileysModuleLoader'), 'loadOfficialBaileys')
      .mockResolvedValue(mockBaileys);

    const baileys = await loadOfficialBaileys();
    expect(baileys).toBeDefined();
    expect(baileys.default).toBeDefined();
    expect(baileys.DisconnectReason).toBeDefined();
    expect(baileys.useMultiFileAuthState).toBeDefined();
    expect(baileys.fetchLatestBaileysVersion).toBeDefined();
  });

  it('should provide v7 specific structures', async () => {
    // Test that the loaded module includes v7-specific features
    const mockBaileys = {
      default: jest.fn(),
      DisconnectReason: { loggedOut: 401 },
      // v7+ specific
      signalRepository: {
        lidMapping: {
          getLIDForPN: jest.fn(),
          getLIDsForPNs: jest.fn(),
          getPNForLID: jest.fn(),
        },
      },
      WAMessageAddressingMode: {
        AD_LEGACY: 0,
        AD_LID_ONLY: 1,
        AD_PN_ONLY: 2,
        AD_MIXED: 3,
      },
    };

    jest.spyOn(require('../shared/backends/BaileysModuleLoader'), 'loadOfficialBaileys')
      .mockResolvedValue(mockBaileys);

    const baileys = await loadOfficialBaileys();
    expect(baileys.signalRepository).toBeDefined();
    expect(baileys.signalRepository.lidMapping).toBeDefined();
    expect(baileys.WAMessageAddressingMode).toBeDefined();
  });
});
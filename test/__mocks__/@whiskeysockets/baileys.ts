/**
 * Mock for @whiskeysockets/baileys v7 used in Jest tests.
 * Prevents real WebSocket connections during unit testing.
 * Compatible with Baileys v7.0.0-rc10+ API.
 */

const mockSocket = {
  ev: {
    on: jest.fn(),
    off: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  user: { id: '1234567890:1@s.whatsapp.net', name: 'Test User' },
  sendMessage: jest.fn().mockResolvedValue({ key: { id: 'mock-msg-id' }, messageTimestamp: Date.now() }),
  logout: jest.fn().mockResolvedValue(undefined),
  end: jest.fn(),
  requestPairingCode: jest.fn().mockResolvedValue('ABC-123'),
  groupCreate: jest.fn().mockResolvedValue({ id: 'group@g.us' }),
  groupMetadata: jest.fn().mockResolvedValue({
    id: 'group@g.us',
    subject: 'Test Group',
    participants: [],
    // v7+ group metadata includes both owner and ownerPn
    owner: 'lid-owner@s.whatsapp.net',
    ownerPn: '1234567890@s.whatsapp.net',
  }),
  groupParticipantsUpdate: jest.fn().mockResolvedValue([]),
  groupInviteCode: jest.fn().mockResolvedValue('invitecode123'),
  groupRevokeInvite: jest.fn().mockResolvedValue('newcode456'),
  groupAcceptInvite: jest.fn().mockResolvedValue('group@g.us'),
  groupLeave: jest.fn().mockResolvedValue(undefined),
  groupUpdateSubject: jest.fn().mockResolvedValue(undefined),
  groupUpdateDescription: jest.fn().mockResolvedValue(undefined),
  groupSettingUpdate: jest.fn().mockResolvedValue(undefined),
  groupFetchAllParticipating: jest.fn().mockResolvedValue({}),
  profilePictureUrl: jest.fn().mockResolvedValue('https://example.com/pic.jpg'),
  updateProfilePicture: jest.fn().mockResolvedValue(undefined),
  updateProfileStatus: jest.fn().mockResolvedValue(undefined),
  updateProfileName: jest.fn().mockResolvedValue(undefined),
  updateBlockStatus: jest.fn().mockResolvedValue(undefined),
  getBusinessProfile: jest.fn().mockResolvedValue({}),
  fetchPrivacySettings: jest.fn().mockResolvedValue({}),
  updatePrivacySettings: jest.fn().mockResolvedValue(undefined),
  fetchStatus: jest.fn().mockResolvedValue({ status: 'Hey there!', setAt: new Date() }),
  onWhatsApp: jest.fn().mockResolvedValue([{ exists: true, jid: '1234567890@s.whatsapp.net' }]),
  fetchBlocklist: jest.fn().mockResolvedValue([]),
  sendPresenceUpdate: jest.fn().mockResolvedValue(undefined),
  getUSyncDevices: jest.fn().mockResolvedValue([]),
  store: {
    contacts: {},
    chats: { all: () => [] },
  },
  // v7+ signalRepository for LID mappings
  signalRepository: {
    lidMapping: {
      getLIDForPN: jest.fn(),
      getLIDsForPNs: jest.fn(),
      getPNForLID: jest.fn(),
      storeLIDPNMapping: jest.fn(),
      storeLIDPNMappings: jest.fn(),
    },
  },
};

const makeWASocket = jest.fn(() => mockSocket);

export default makeWASocket;
export { makeWASocket };

export const DisconnectReason = {
  loggedOut: 401,
  connectionClosed: 428,
  connectionLost: 408,
  connectionReplaced: 440,
  timedOut: 408,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411,
};

export const useMultiFileAuthState = jest.fn().mockResolvedValue({
  state: {
    creds: {},
    keys: {},
    // v7+ auth state includes new required fields
    'lid-mapping': {},
    'device-list': {},
    'tctoken': {},
  },
  saveCreds: jest.fn().mockResolvedValue(undefined),
});

export const fetchLatestBaileysVersion = jest.fn().mockResolvedValue({
  version: [2, 3000, 0],
  isLatest: true
});

export const proto = {
  IMessageKey: {},
  IWebMessageInfo: {},
};

export const BufferJSON = {
  encode: jest.fn(),
  decode: jest.fn(),
};

export const DEFAULT_CONNECTION_CONFIG = {
  connectTimeoutMs: 60000,
  keepAliveIntervalMs: 25000,
  pingIntervalMs: 10000,
};

// v7+ constants
export const WAMessageAddressingMode = {
  AD_LEGACY: 0,
  AD_LID_ONLY: 1,
  AD_PN_ONLY: 2,
  AD_MIXED: 3,
};
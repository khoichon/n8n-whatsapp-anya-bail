import * as os from 'os';
import * as path from 'path';

export const BASE_DIR = path.join(os.homedir(), '.n8n', 'whatsapp');
export const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
export const LOGS_DIR = path.join(BASE_DIR, 'logs');
export const CACHE_DIR = path.join(BASE_DIR, 'cache');
export const QR_CACHE_DIR = path.join(CACHE_DIR, 'qr');
export const METADATA_FILE = path.join(BASE_DIR, 'metadata.json');

export const RECONNECT_INTERVAL_MS = 5000;
export const MAX_RECONNECT_ATTEMPTS = 10;
export const QR_TIMEOUT_MS = 60000;
export const PAIRING_CODE_TIMEOUT_MS = 120000;
export const SESSION_PING_INTERVAL_MS = 30000;

export const DEFAULT_BROWSER: [string, string, string] = ['n8n-baileys', 'Chrome', '120.0.0'];

export const SUPPORTED_EVENTS = [
  'messages.upsert',
  'messages.update',
  'messages.delete',
  'groups.update',
  'group-participants.update',
  'presence.update',
  'contacts.update',
  'chats.update',
  'connection.update',
  'creds.update',
  'call',
  'blocklist.update',
] as const;

export type SupportedEvent = typeof SUPPORTED_EVENTS[number];

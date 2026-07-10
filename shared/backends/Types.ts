/**
 * Backend abstraction layer — core types.
 *
 * This file intentionally has ZERO dependency on `anya-bail` or `baileys`.
 * Nodes and shared helpers should depend on these types, never on a
 * backend-specific SDK type, so that swapping/adding backends never
 * requires touching node code.
 */

/** Identifier for a pluggable WhatsApp backend implementation. */
export type BackendId = 'legacy' | 'official';

/** Value used in the credential / node "Backend Override" dropdown. */
export type BackendSelection = 'useCredential' | BackendId;

/**
 * Feature flags every backend must declare. Nodes consult this before
 * attempting an operation and fail loudly (NodeOperationError) instead
 * of silently no-oping when a feature isn't supported.
 */
export interface BackendCapabilities {
  messages: boolean;
  media: boolean;
  polls: boolean;
  reactions: boolean;
  presence: boolean;
  channels: boolean;
  newsletters: boolean;
  editing: boolean;
  status: boolean;
  buttons: boolean;
  lists: boolean;
  groupManagement: boolean;
  qrLogin: boolean;
  pairingCode: boolean;
  calls: boolean;
  businessProfile: boolean;
  privacySettings: boolean;
  blocklist: boolean;
  /** anya-bail-exclusive: `{ ai: true }` message flag. */
  aiIcon: boolean;
  /** anya-bail-exclusive: `sock.sendTable(...)`. */
  tableMessages: boolean;
  /** Raw JS node access to the underlying socket. Always true today. */
  rawSocketAccess: boolean;
}

export type WhatsAppEventName =
  | 'connection.update'
  | 'creds.update'
  | 'messages.upsert'
  | 'messages.update'
  | 'messages.delete'
  | 'message-receipt.update'
  | 'messages.reaction'
  | 'presence.update'
  | 'chats.update'
  | 'chats.delete'
  | 'chats.upsert'
  | 'contacts.update'
  | 'contacts.upsert'
  | 'groups.update'
  | 'group-participants.update'
  | 'call'
  | 'blocklist.update'
  | 'lid-mapping.update';

export type EventSubscriber = (data: unknown) => void | Promise<void>;

export interface CreateSessionOptions {
  sessionId: string;
  pairingPhone?: string;
  usePairingCode?: boolean;
}

export interface SessionInfo {
  sessionId: string;
  backend: BackendId;
  phone?: string;
  pushName?: string;
  connected: boolean;
  hasQR: boolean;
  hasPairingCode: boolean;
  qrCode?: string;
  pairingCode?: string;
  reconnectAttempts: number;
  createdAt: string;
  lastConnectedAt?: string;
}

/**
 * Minimal structural interface for the object returned by
 * `sock.sendMessage(...)` across both anya-bail and official Baileys.
 * Both SDKs share the same lineage (official Baileys), so their
 * runtime shapes are structurally compatible even though they come
 * from different packages/types.
 */
export interface WAMessageLike {
  key?: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null };
  messageTimestamp?: number | Long | null;
}

// `Long` isn't imported to avoid a hard dependency; both SDKs sometimes
// return protobuf Long objects for timestamps.
type Long = { toNumber(): number } | number;

export interface SendResult {
  messageId: string;
  timestamp: number;
  status: string;
  jid: string;
}

import type { WASocket, ConnectionState } from 'anya-bail';
import type { SupportedEvent } from './Constants';

export interface SessionMetadata {
  sessionId: string;
  phone?: string;
  pushName?: string;
  connected: boolean;
  createdAt: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  reconnectAttempts: number;
}

export interface SessionState {
  socket: WASocket | null;
  metadata: SessionMetadata;
  qrCode?: string;
  qrImagePath?: string;
  pairingCode?: string;
  connectionState: Partial<ConnectionState>;
  reconnectTimer?: NodeJS.Timeout;
  isReconnecting: boolean;
  subscribers: Map<SupportedEvent, Set<EventSubscriber>>;
}

export type EventSubscriber = (data: unknown) => void | Promise<void>;

export interface CreateSessionOptions {
  sessionId: string;
  pairingPhone?: string;
  usePairingCode?: boolean;
  printQR?: boolean;
}

export interface SessionInfo {
  sessionId: string;
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

export interface SendMessageResult {
  messageId: string;
  timestamp: number;
  status: string;
  jid: string;
}

export interface MediaInput {
  type: 'url' | 'binary' | 'base64' | 'path';
  data: string | Buffer;
  mimeType?: string;
  filename?: string;
}

export interface GroupInfo {
  id: string;
  subject: string;
  description?: string;
  owner?: string;
  creation?: number;
  participants: GroupParticipant[];
  inviteCode?: string;
  announce?: boolean;
  restrict?: boolean;
}

export interface GroupParticipant {
  id: string;
  admin?: 'admin' | 'superadmin' | null;
}

export interface ContactInfo {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  imgUrl?: string;
  status?: string;
}

export interface PrivacySettings {
  readreceipts?: string;
  profile?: string;
  status?: string;
  online?: string;
  last?: string;
  groupadd?: string;
  calladd?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'pairing_pending';

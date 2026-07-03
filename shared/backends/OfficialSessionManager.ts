import * as os from 'os';
import * as path from 'path';
import { Boom } from '@hapi/boom';

import { loadOfficialBaileys } from './BaileysModuleLoader';
import { BackendEventBus } from './BackendEventBus';
import { makeSessionDirHelpers, JsonMetadataStore, generateQRImageFile, ensureDir } from './StorageKit';
import { normalisePhoneForPairing } from '../Utils';
import type { WAClientSocket } from './SocketInterface';
import type { CreateSessionOptions, SessionInfo, WhatsAppEventName, EventSubscriber } from './Types';

// Separate root so official-backend auth state never shares a directory
// with (or risks overwriting) legacy anya-bail session files.
const BASE_DIR = path.join(os.homedir(), '.n8n', 'whatsapp-official');
const SESSIONS_DIR = path.join(BASE_DIR, 'sessions');
const LOGS_DIR = path.join(BASE_DIR, 'logs');
const QR_CACHE_DIR = path.join(BASE_DIR, 'cache', 'qr');
const METADATA_FILE = path.join(BASE_DIR, 'metadata.json');

const RECONNECT_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_BROWSER: [string, string, string] = ['n8n-baileys-official', 'Chrome', '120.0.0'];

const { getSessionDir, ensureSessionDir, sessionExists, listSessionIds, deleteSessionFiles } =
  makeSessionDirHelpers(SESSIONS_DIR);

interface OfficialMetadata {
  sessionId: string;
  phone?: string;
  pushName?: string;
  connected: boolean;
  createdAt: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  reconnectAttempts: number;
}

interface OfficialSessionState {
  socket: WAClientSocket | null;
  metadata: OfficialMetadata;
  qrCode?: string;
  pairingCode?: string;
  isReconnecting: boolean;
  reconnectTimer?: NodeJS.Timeout;
  bus: BackendEventBus;
}

function log(level: 'info' | 'warn' | 'error', sessionId: string, message: string, data?: unknown): void {
  ensureDir(LOGS_DIR);
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [official:${sessionId}] ${message}${
    data ? ' ' + JSON.stringify(data) : ''
  }\n`;
  try {
    require('fs').appendFileSync(path.join(LOGS_DIR, `${sessionId}.log`), line, 'utf8');
  } catch {
    /* non-fatal */
  }
  if (level === 'error' || process.env.WA_DEBUG === '1') {
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](`[WA-official:${sessionId}] ${message}`, data ?? '');
  }
}

export class OfficialSessionManager {
  private static instance: OfficialSessionManager;
  private sessions = new Map<string, OfficialSessionState>();
  private metadata = new JsonMetadataStore<OfficialMetadata>(METADATA_FILE, sessionId => ({
    sessionId,
    connected: false,
    createdAt: new Date().toISOString(),
    reconnectAttempts: 0,
  }));

  static getInstance(): OfficialSessionManager {
    if (!OfficialSessionManager.instance) OfficialSessionManager.instance = new OfficialSessionManager();
    return OfficialSessionManager.instance;
  }

  async create(options: CreateSessionOptions): Promise<OfficialSessionState> {
    const existing = this.sessions.get(options.sessionId);
    if (existing?.socket) return existing;
    return this._initSession(options);
  }

  get(sessionId: string): OfficialSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  getSocket(sessionId: string): WAClientSocket | null {
    return this.sessions.get(sessionId)?.socket ?? null;
  }

  getOrThrow(sessionId: string): WAClientSocket {
    const sock = this.getSocket(sessionId);
    if (!sock) throw new Error(`Session "${sessionId}" is not connected (backend: Official Baileys).`);
    return sock;
  }

  async disconnect(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this._clearReconnectTimer(state);
    state.isReconnecting = false;
    try {
      state.socket?.end(undefined);
    } catch {
      /* ignore */
    }
    state.socket = null;
    this.metadata.update(sessionId, { connected: false, lastDisconnectedAt: new Date().toISOString() });
  }

  async delete(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (state) {
      this._clearReconnectTimer(state);
      state.bus.clearAll();
      try {
        await state.socket?.logout();
      } catch {
        /* ignore */
      }
      try {
        state.socket?.end(undefined);
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(sessionId);
    deleteSessionFiles(sessionId);
    this.metadata.delete(sessionId);
  }

  listSessions(): SessionInfo[] {
    const ids = new Set([...this.sessions.keys(), ...this.metadata.listIds()]);
    return [...ids].map(id => this._buildInfo(id));
  }

  getQR(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.qrCode;
  }

  getPairingCode(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.pairingCode;
  }

  subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
    const state = this._getOrCreateState(sessionId);
    return state.bus.subscribe(event, subscriber);
  }

  async restoreAll(): Promise<void> {
    for (const id of listSessionIds()) {
      if (sessionExists(id)) {
        try {
          await this.create({ sessionId: id });
        } catch (err) {
          log('error', id, 'restoreAll: failed to restore', (err as Error).message);
        }
      }
    }
  }

  // ── internal ──────────────────────────────────────────────────────────

  private _getOrCreateState(sessionId: string): OfficialSessionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        socket: null,
        metadata: {
          sessionId,
          connected: false,
          createdAt: new Date().toISOString(),
          reconnectAttempts: 0,
        },
        isReconnecting: false,
        bus: new BackendEventBus(sessionId),
      });
    }
    return this.sessions.get(sessionId)!;
  }

  private async _initSession(options: CreateSessionOptions): Promise<OfficialSessionState> {
    const { sessionId, pairingPhone, usePairingCode = false } = options;
    ensureSessionDir(sessionId);

    const baileys = await loadOfficialBaileys();
    const { state: authState, saveCreds } = await baileys.useMultiFileAuthState(getSessionDir(sessionId));
    const { version } = await baileys.fetchLatestBaileysVersion();

    const sessionState = this._getOrCreateState(sessionId);
    sessionState.isReconnecting = false;
    sessionState.qrCode = undefined;
    sessionState.pairingCode = undefined;

    const sock: WAClientSocket = baileys.default({
      auth: authState,
      version,
      printQRInTerminal: false,
      browser: DEFAULT_BROWSER,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
    });

    sessionState.socket = sock;
    this.metadata.update(sessionId, { connected: false, reconnectAttempts: 0 });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      sessionState.bus.publish('creds.update', {});
    });

    sock.ev.on('connection.update', async (update: Record<string, unknown>) => {
      const { connection, lastDisconnect, qr } = update as {
        connection?: string;
        lastDisconnect?: { error?: unknown };
        qr?: string;
      };
      sessionState.bus.publish('connection.update', update);

      if (qr) {
        sessionState.qrCode = qr;
        try {
          await generateQRImageFile(qr, sessionId, QR_CACHE_DIR);
        } catch {
          /* non-critical */
        }
        log('info', sessionId, 'QR code generated');
      }

      if (connection === 'open') {
        sessionState.metadata.reconnectAttempts = 0;
        sessionState.metadata.connected = true;
        sessionState.metadata.phone = sock.user?.id?.split(':')[0] ?? sock.user?.id;
        sessionState.metadata.pushName = sock.user?.name;
        sessionState.metadata.lastConnectedAt = new Date().toISOString();
        this.metadata.update(sessionId, sessionState.metadata);
        log('info', sessionId, 'Connected', { phone: sessionState.metadata.phone });
      }

      if (connection === 'close') {
        sessionState.metadata.connected = false;
        sessionState.metadata.lastDisconnectedAt = new Date().toISOString();
        this.metadata.update(sessionId, sessionState.metadata);

        const err = (lastDisconnect?.error as Boom | undefined);
        const code = err?.output?.statusCode;
        const loggedOut = code === baileys.DisconnectReason?.loggedOut;

        log('warn', sessionId, 'Connection closed', { code, loggedOut });

        if (loggedOut) {
          deleteSessionFiles(sessionId);
          sessionState.socket = null;
          return;
        }

        const attempts = (sessionState.metadata.reconnectAttempts ?? 0) + 1;
        sessionState.metadata.reconnectAttempts = attempts;
        this.metadata.update(sessionId, { reconnectAttempts: attempts });

        if (attempts <= MAX_RECONNECT_ATTEMPTS && !sessionState.isReconnecting) {
          sessionState.isReconnecting = true;
          const delay = RECONNECT_INTERVAL_MS * Math.min(attempts, 5);
          log('info', sessionId, `Reconnecting in ${delay}ms (attempt ${attempts})`);

          sessionState.reconnectTimer = setTimeout(async () => {
            sessionState.isReconnecting = false;
            if (this.sessions.has(sessionId)) {
              try {
                await this._initSession(options);
              } catch (e) {
                log('error', sessionId, 'Reconnect failed', (e as Error).message);
              }
            }
          }, delay);
        } else {
          log('error', sessionId, 'Max reconnect attempts reached; giving up');
        }
      }
    });

    // Fan out every other event the official SDK emits.
    const PASSTHROUGH_EVENTS: WhatsAppEventName[] = [
      'messages.upsert',
      'messages.update',
      'messages.delete',
      'message-receipt.update',
      'messages.reaction',
      'presence.update',
      'chats.update',
      'chats.delete',
      'chats.upsert',
      'contacts.update',
      'contacts.upsert',
      'groups.update',
      'group-participants.update',
      'call',
      'blocklist.update',
    ];
    for (const event of PASSTHROUGH_EVENTS) {
      sock.ev.on(event, (data: unknown) => sessionState.bus.publish(event, data));
    }

    // Pairing codes are requested directly over the freshly-created socket
    // rather than waiting for a `qr` event: WhatsApp does not always emit
    // one before the caller's polling window (see WhatsAppLogin node)
    // elapses, which previously left `pairingCode` stuck at null.
    if (usePairingCode && pairingPhone && !authState.creds?.registered) {
      try {
        sessionState.pairingCode = await sock.requestPairingCode(normalisePhoneForPairing(pairingPhone));
        log('info', sessionId, 'Pairing code generated');
      } catch (e) {
        log('error', sessionId, 'Failed to generate pairing code', (e as Error).message);
      }
    }

    log('info', sessionId, 'Session initialised');
    return sessionState;
  }

  private _clearReconnectTimer(state: OfficialSessionState): void {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = undefined;
    }
  }

  private _buildInfo(sessionId: string): SessionInfo {
    const state = this.sessions.get(sessionId);
    const meta =
      this.metadata.get(sessionId) ?? {
        sessionId,
        connected: false,
        createdAt: new Date().toISOString(),
        reconnectAttempts: 0,
      };
    return {
      sessionId,
      backend: 'official',
      phone: meta.phone,
      pushName: meta.pushName,
      connected: state?.socket !== null && (meta.connected ?? false),
      hasQR: !!state?.qrCode,
      hasPairingCode: !!state?.pairingCode,
      qrCode: state?.qrCode,
      pairingCode: state?.pairingCode,
      reconnectAttempts: meta.reconnectAttempts ?? 0,
      createdAt: meta.createdAt,
      lastConnectedAt: meta.lastConnectedAt,
    };
  }
}

export { sessionExists as officialSessionExistsOnDisk };
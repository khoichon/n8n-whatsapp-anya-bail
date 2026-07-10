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
const DEFAULT_BROWSER: [string, string, string] = ['Chrome', 'Windows', '10.0'];

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
  /** Authentication method: 'qr' or 'pairing' */
  authMethod?: 'qr' | 'pairing';
  /** Phone number for pairing code authentication (digits only) */
  pairingPhone?: string;
}

interface OfficialSessionState {
  socket: WAClientSocket | null;
  metadata: OfficialMetadata;
  qrCode?: string;
  pairingCode?: string;
  pairingDebug?: string[];
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
    if (existing?.socket) {
      if (!options.usePairingCode) return existing;
      // See shared/SessionManager.ts create() for why pairing-code
      // requests always force a fresh socket rather than reusing a
      // cached one.
      await this.disconnect(options.sessionId);
    }
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

  /** Rolling trail of pairing-code attempt events, for the node to surface
   *  in its output JSON (visible in the n8n UI) when generation fails. */
  getPairingDebug(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.pairingDebug ?? [];
  }

  private _debug(state: OfficialSessionState, message: string): void {
    if (!state.pairingDebug) state.pairingDebug = [];
    state.pairingDebug.push(`[${new Date().toISOString()}] ${message}`);
    if (state.pairingDebug.length > 50) state.pairingDebug.shift();
  }

  subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
    const state = this._getOrCreateState(sessionId);
    return state.bus.subscribe(event, subscriber);
  }

  async restoreAll(): Promise<void> {
    const ids = listSessionIds();
    log('info', 'SYSTEM', `restoreAll: found ${ids.length} session directories: ${ids.join(', ')}`);

    for (const id of ids) {
      if (sessionExists(id)) {
        try {
          log('info', 'SYSTEM', `restoreAll: processing session "${id}"`);

          // Load saved authentication preferences from metadata
          const meta = this.metadata.get(id);
          log('info', id, `restoreAll: metadata=${meta ? 'found' : 'missing'}, authMethod=${meta?.authMethod}`);

          if (meta && (meta.authMethod === 'pairing' || meta.authMethod === 'qr')) {
            // Auto-login with saved authentication preferences
            log('info', id, `restoreAll: creating session with authMethod=${meta.authMethod}, pairingPhone=${meta.pairingPhone}`);
            await this.create({
              sessionId: id,
              usePairingCode: meta.authMethod === 'pairing',
              pairingPhone: meta.pairingPhone,
            });
            log('info', id, 'restoreAll: session created successfully');
          }
          // If no auth preferences saved, skip auto-login
          // The WhatsAppLogin node will create the session on-demand using current credential settings
          else {
            log('info', id, `restoreAll: skipping auto-login (no valid auth preferences)`);
          }
        } catch (err) {
          log('error', id, 'restoreAll: failed to restore', (err as Error).message);
        }
      } else {
        log('info', 'SYSTEM', `restoreAll: session "${id}" has no files on disk, skipping`);
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

    const sessionState = this._getOrCreateState(sessionId);

    // Clear any existing reconnect timer before creating new session
    this._clearReconnectTimer(sessionState);

    // Properly disconnect existing socket if any
    if (sessionState.socket) {
      try {
        sessionState.socket.end(undefined);
      } catch {
        /* ignore */
      }
      sessionState.socket = null;
    }

    const baileys = await loadOfficialBaileys();
    const { state: authState, saveCreds } = await baileys.useMultiFileAuthState(getSessionDir(sessionId));
    const { version } = await baileys.fetchLatestBaileysVersion();

    sessionState.isReconnecting = false;
    sessionState.qrCode = undefined;
    sessionState.pairingCode = undefined;
    sessionState.pairingDebug = [];

    // Check if credentials already exist and have essential crypto material
    // Even if registered=false, sessions with noiseKey and pairingEphemeralKeyPair
    // may be able to connect without going through QR/pairing code again
    const creds = (authState as { creds?: { registered?: boolean; user?: string; noiseKey?: any; pairingEphemeralKeyPair?: any } }).creds;
    const hasExistingAuth = creds && (
      creds.registered === true ||
      (creds.user && typeof creds.user === 'string') ||
      (creds.noiseKey && creds.pairingEphemeralKeyPair) // Has essential crypto material
    );

    // Use pairing code only for new sessions, not for already-authenticated sessions
    const shouldUsePairingCode = usePairingCode && !hasExistingAuth;

    // Save authentication preferences to metadata for auto-initialization on boot
    const authMethod = shouldUsePairingCode ? 'pairing' : 'qr';
    this.metadata.update(sessionId, {
      authMethod,
      pairingPhone: shouldUsePairingCode ? pairingPhone : undefined,
    });

    if (usePairingCode) {
      this._debug(
        sessionState,
        `connect() called with usePairingCode=${usePairingCode}, shouldUsePairingCode=${shouldUsePairingCode}, ` +
          `phone="${pairingPhone ?? ''}", creds.registered=${Boolean(creds?.registered)}, ` +
          `hasExistingAuth=${hasExistingAuth}`,
      );
    }

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

    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update: Record<string, unknown>) => {
      const { connection, lastDisconnect, qr } = update as {
        connection?: string;
        lastDisconnect?: { error?: unknown };
        qr?: string;
      };
      sessionState.bus.publish('connection.update', update);

      if (usePairingCode) {
        const disconnectMsg = lastDisconnect?.error
          ? ` lastDisconnect="${(lastDisconnect.error as Error).message}"`
          : '';
        this._debug(
          sessionState,
          `connection.update: connection="${connection ?? ''}" qr=${qr ? 'present' : 'none'}${disconnectMsg}`,
        );
      }

      if (qr) {
        // In pairing code mode, don't save QR code - only request pairing code
        if (!shouldUsePairingCode) {
          sessionState.qrCode = qr;
          try {
            await generateQRImageFile(qr, sessionId, QR_CACHE_DIR);
          } catch {
            /* non-critical */
          }
          log('info', sessionId, 'QR code generated');
        }

        // Matches upstream Baileys' own reference usage (Example/example.ts):
        // requestPairingCode() must be called after the socket has produced
        // a `qr` ref (i.e. the handshake has completed) — calling it earlier
        // throws "Connection Closed". The phone number must be digits only;
        // WhatsApp rejects "+", spaces and dashes silently.
        //
        // IMPORTANT: Only request the pairing code ONCE. Pairing codes are
        // cryptographically bound to the QR ref that was current when requested.
        // If we request again on QR rotation, the new code invalidates the old one,
        // producing "Couldn't link device... or get a new code" even though the
        // user was entering a perfectly valid code. Users must enter the code
        // within ~20 seconds before the QR rotates naturally.
        if (shouldUsePairingCode && pairingPhone && !pairingCodeRequested) {
          pairingCodeRequested = true;
          const sanitisedPhone = normalisePhoneForPairing(pairingPhone);
          this._debug(sessionState, `Requesting pairing code for phone="${sanitisedPhone}"`);
          try {
            sessionState.pairingCode = await sock.requestPairingCode(sanitisedPhone);
            this._debug(sessionState, `Pairing code received: "${sessionState.pairingCode}"`);
            log('info', sessionId, 'Pairing code generated');
          } catch (e) {
            this._debug(sessionState, `requestPairingCode() threw: ${(e as Error).message}`);
            log('error', sessionId, 'Failed to generate pairing code', (e as Error).message);
            // Allow a retry on the next qr rotation, since this attempt
            // never produced a code for the user to act on.
            pairingCodeRequested = false;
          }
        }
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
                // Properly disconnect old socket before creating new one
                const oldState = this.sessions.get(sessionId);
                if (oldState?.socket) {
                  try {
                    oldState.socket.end(undefined);
                  } catch {
                    /* ignore */
                  }
                  oldState.socket = null;
                }
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
      'lid-mapping.update', // Baileys v7+ LID/PN mapping updates
    ];
    for (const event of PASSTHROUGH_EVENTS) {
      sock.ev.on(event, (data: unknown) => sessionState.bus.publish(event, data));
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
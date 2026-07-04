import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
  fetchLatestBaileysVersion
} from 'anya-bail';
import { Boom } from '@hapi/boom';

import { EventBus } from './EventBus';
import { MetadataStore } from './MetadataStore';
import { SessionLogger } from './Logger';
import { generateQRImage } from './QRGenerator';
import {
  ensureSessionDir,
  sessionExists,
  listSessionIds,
  deleteSessionFiles,
} from './SessionStore';
import {
  RECONNECT_INTERVAL_MS,
  MAX_RECONNECT_ATTEMPTS,
  DEFAULT_BROWSER,
  SUPPORTED_EVENTS,
  type SupportedEvent,
} from './Constants';
import type {
  SessionState,
  SessionInfo,
  CreateSessionOptions,
  EventSubscriber,
} from './Types';
import { sleep, normalisePhoneForPairing } from './Utils';

export class SessionManager {
  
  private static instance: SessionManager;
  private sessions = new Map<string, SessionState>();
  private metadata = MetadataStore.getInstance();

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async create(options: CreateSessionOptions): Promise<SessionState> {
    const { sessionId } = options;

    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      if (existing.socket !== null) return existing;
      // Socket is null — re-connect
    }

    return this._initSession(options);
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  getSocket(sessionId: string): WASocket | null {
    return this.sessions.get(sessionId)?.socket ?? null;
  }

  getOrThrow(sessionId: string): WASocket {
    const sock = this.getSocket(sessionId);
    if (!sock) throw new Error(`Session "${sessionId}" is not connected.`);
    return sock;
  }

  async delete(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (state) {
      this._clearReconnectTimer(state);
      state.bus?.clearAll();
      try { await state.socket?.logout(); } catch { /* ignore */ }
      try { state.socket?.end(undefined); } catch { /* ignore */ }
    }
    this.sessions.delete(sessionId);
    deleteSessionFiles(sessionId);
    this.metadata.delete(sessionId);
  }

  async disconnect(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this._clearReconnectTimer(state);
    state.isReconnecting = false;
    try { state.socket?.end(undefined); } catch { /* ignore */ }
    state.socket = null;
    this.metadata.update(sessionId, {
      connected: false,
      lastDisconnectedAt: new Date().toISOString(),
    });
  }

  listSessions(): SessionInfo[] {
    const allIds = new Set([
      ...this.sessions.keys(),
      ...this.metadata.listIds(),
    ]);
    return [...allIds].map(id => this._buildSessionInfo(id));
  }

  getQR(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.qrCode;
  }

  getQRImagePath(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.qrImagePath;
  }

  getPairingCode(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.pairingCode;
  }

  /** Rolling trail of pairing-code attempt events, for the node to surface
   *  in its output JSON (visible in the n8n UI) when generation fails. */
  getPairingDebug(sessionId: string): string[] {
    return this.sessions.get(sessionId)?.pairingDebug ?? [];
  }

  private _debug(state: SessionState, message: string): void {
    if (!state.pairingDebug) state.pairingDebug = [];
    state.pairingDebug.push(`[${new Date().toISOString()}] ${message}`);
    if (state.pairingDebug.length > 50) state.pairingDebug.shift();
  }

  subscribe(
    sessionId: string,
    event: SupportedEvent,
    subscriber: EventSubscriber,
  ): () => void {
    const state = this._getOrCreateState(sessionId);
    return state.bus.subscribe(event, subscriber);
  }

  async restoreAll(): Promise<void> {
    const ids = listSessionIds();
    for (const id of ids) {
      if (sessionExists(id)) {
        try {
          await this.create({ sessionId: id });
        } catch (err) {
          new SessionLogger(id).error('restoreAll: failed to restore', err);
        }
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _getOrCreateState(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      const state: SessionState = {
        socket: null,
        metadata: {
          sessionId,
          connected: false,
          createdAt: new Date().toISOString(),
          reconnectAttempts: 0,
        },
        connectionState: {},
        isReconnecting: false,
        subscribers: new Map(),
        bus: new EventBus(sessionId),
        pairingDebug: [],
      } as SessionState & { bus: EventBus };
      this.sessions.set(sessionId, state);
    }
    return this.sessions.get(sessionId)!;
  }

  private async _initSession(options: CreateSessionOptions): Promise<SessionState> {
    const { sessionId, pairingPhone, usePairingCode = false } = options;
    const logger = new SessionLogger(sessionId);

    ensureSessionDir(sessionId);

    const { state: authState, saveCreds } = await useMultiFileAuthState(
      require('./SessionStore').getSessionDir(sessionId),
    );

    const { version } = await fetchLatestBaileysVersion();

    const sessionState = this._getOrCreateState(sessionId);
    sessionState.isReconnecting = false;
    sessionState.qrCode = undefined;
    sessionState.pairingCode = undefined;
    sessionState.pairingDebug = [];

    if (usePairingCode) {
      this._debug(
        sessionState,
        `connect() called with usePairingCode=true, phone="${pairingPhone ?? ''}", ` +
          `creds.registered=${Boolean((authState as { creds?: { registered?: boolean } }).creds?.registered)}`,
      );
    }

    const sock = makeWASocket({
      auth: authState,
      version:version,
      printQRInTerminal: false,
      browser: DEFAULT_BROWSER,
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
    });

    sessionState.socket = sock;
    this.metadata.update(sessionId, { sessionId, connected: false, createdAt: sessionState.metadata.createdAt, reconnectAttempts: 0 });

    // Creds
    sock.ev.on('creds.update', async () => {
      await saveCreds();
      sessionState.bus?.publish('creds.update', {});
    });

    // Connection state
    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;
      Object.assign(sessionState.connectionState, update);
      sessionState.bus?.publish('connection.update', update);

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
        sessionState.qrCode = qr;
        try {
          sessionState.qrImagePath = await generateQRImage(qr, sessionId);
        } catch { /* non-critical */ }
        logger.info('QR code generated');

        // Matches upstream Baileys' own reference usage (Example/example.ts):
        // requestPairingCode() must be called after the socket has produced
        // a `qr` ref (i.e. the handshake has completed) — calling it earlier
        // throws "Connection Closed". The phone number must be digits only;
        // WhatsApp rejects "+", spaces and dashes silently.
        if (usePairingCode && pairingPhone) {
          const sanitisedPhone = normalisePhoneForPairing(pairingPhone);
          this._debug(sessionState, `Requesting pairing code for phone="${sanitisedPhone}"`);
          try {
            const code = await sock.requestPairingCode(sanitisedPhone);
            sessionState.pairingCode = code;
            this._debug(sessionState, `Pairing code received: "${code}"`);
            logger.info('Pairing code generated', { code });
          } catch (e) {
            this._debug(sessionState, `requestPairingCode() threw: ${(e as Error).message}`);
            logger.error('Failed to generate pairing code', e);
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
        logger.info('Connected', { phone: sessionState.metadata.phone });
      }

      if (connection === 'close') {
        sessionState.metadata.connected = false;
        sessionState.metadata.lastDisconnectedAt = new Date().toISOString();
        this.metadata.update(sessionId, sessionState.metadata);

        const err = lastDisconnect?.error as Boom | undefined;
        const code = err?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        logger.warn('Connection closed', { code, loggedOut });

        if (loggedOut) {
          logger.info('Session logged out; clearing credentials');
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
          logger.info(`Reconnecting in ${delay}ms (attempt ${attempts})`);

          sessionState.reconnectTimer = setTimeout(async () => {
            sessionState.isReconnecting = false;
            if (this.sessions.has(sessionId)) {
              try {
                await this._initSession(options);
              } catch (e) {
                logger.error('Reconnect failed', e);
              }
            }
          }, delay);
        } else {
          logger.error('Max reconnect attempts reached; giving up');
        }
      }
    });

    // Fan out all supported socket events to the EventBus
    for (const event of SUPPORTED_EVENTS) {
      if (event === 'connection.update' || event === 'creds.update') continue;
      sock.ev.on(event as never, (data: unknown) => {
        sessionState.bus?.publish(event, data);
      });
    }

    logger.info('Session initialised');
    return sessionState;
  }

  private _clearReconnectTimer(state: SessionState): void {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = undefined;
    }
  }

  private _buildSessionInfo(sessionId: string): SessionInfo {
    const state = this.sessions.get(sessionId);
    const meta = this.metadata.get(sessionId) ?? {
      sessionId,
      connected: false,
      createdAt: new Date().toISOString(),
      reconnectAttempts: 0,
    };
    return {
      sessionId,
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

// Augment SessionState with bus
declare module './Types' {
  interface SessionState {
    bus: EventBus;
  }
}

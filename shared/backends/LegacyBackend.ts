import { SessionManager } from '../SessionManager';
import { sessionExists } from '../SessionStore';
import type { WAClientSocket } from './SocketInterface';
import type { IWhatsAppBackend } from './IWhatsAppBackend';
import { LEGACY_CAPABILITIES } from './CapabilityRegistry';
import type { CreateSessionOptions, EventSubscriber, SessionInfo, WhatsAppEventName } from './Types';

/**
 * LegacyBackend
 * ─────────────
 * A thin, behaviour-preserving adapter over the pre-existing
 * `SessionManager` singleton (which talks to `anya-bail`).
 *
 * IMPORTANT: `SessionManager.ts`, `SessionStore.ts`, `MetadataStore.ts`,
 * `EventBus.ts`, `QRGenerator.ts` and the legacy `Types.ts` are all
 * UNCHANGED by this upgrade. Every existing workflow that doesn't touch
 * the new "Backend" credential field runs through this exact same code
 * path it always has — this class adds zero new behaviour, it only
 * exposes the existing manager through the shared `IWhatsAppBackend`
 * shape so nodes can be backend-agnostic.
 */
export class LegacyBackend implements IWhatsAppBackend {
  readonly id = 'legacy' as const;
  readonly capabilities = LEGACY_CAPABILITIES;

  private static _instance: LegacyBackend;
  static getInstance(): LegacyBackend {
    if (!LegacyBackend._instance) LegacyBackend._instance = new LegacyBackend();
    return LegacyBackend._instance;
  }

  private get manager(): SessionManager {
    return SessionManager.getInstance();
  }

  async connect(options: CreateSessionOptions): Promise<void> {
    await this.manager.create(options);
  }

  getOrThrowSocket(sessionId: string): WAClientSocket {
    return this.manager.getOrThrow(sessionId) as unknown as WAClientSocket;
  }

  getSocket(sessionId: string): WAClientSocket | null {
    return this.manager.getSocket(sessionId) as unknown as WAClientSocket | null;
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.manager.disconnect(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.manager.delete(sessionId);
  }

  listSessions(): SessionInfo[] {
    return this.manager.listSessions().map(s => ({ ...s, backend: 'legacy' as const }));
  }

  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.listSessions().find(s => s.sessionId === sessionId);
  }

  getQR(sessionId: string): string | undefined {
    return this.manager.getQR(sessionId);
  }

  getPairingCode(sessionId: string): string | undefined {
    return this.manager.getPairingCode(sessionId);
  }

  subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
    // The legacy SUPPORTED_EVENTS union is a subset of WhatsAppEventName;
    // events outside that subset simply never fire for this backend.
    return this.manager.subscribe(sessionId, event as never, subscriber);
  }

  async restoreAll(): Promise<void> {
    await this.manager.restoreAll();
  }

  /** Exposed for the "Get Status" operation's `exists`-on-disk check. */
  sessionExistsOnDisk(sessionId: string): boolean {
    return sessionExists(sessionId);
  }
}

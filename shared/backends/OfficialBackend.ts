import { OfficialSessionManager, officialSessionExistsOnDisk } from './OfficialSessionManager';
import type { WAClientSocket } from './SocketInterface';
import type { IWhatsAppBackend } from './IWhatsAppBackend';
import { OFFICIAL_CAPABILITIES } from './CapabilityRegistry';
import type { CreateSessionOptions, EventSubscriber, SessionInfo, WhatsAppEventName } from './Types';

/**
 * OfficialBackend
 * ───────────────
 * Adapter over `OfficialSessionManager`, which drives the official
 * `baileys` npm package (WhiskeySockets/Baileys), loaded dynamically
 * because that package is ESM-only (see BaileysModuleLoader.ts).
 */
export class OfficialBackend implements IWhatsAppBackend {
  readonly id = 'official' as const;
  readonly capabilities = OFFICIAL_CAPABILITIES;

  private static _instance: OfficialBackend;
  static getInstance(): OfficialBackend {
    if (!OfficialBackend._instance) OfficialBackend._instance = new OfficialBackend();
    return OfficialBackend._instance;
  }

  private get manager(): OfficialSessionManager {
    return OfficialSessionManager.getInstance();
  }

  async connect(options: CreateSessionOptions): Promise<void> {
    await this.manager.create(options);
  }

  getOrThrowSocket(sessionId: string): WAClientSocket {
    return this.manager.getOrThrow(sessionId);
  }

  getSocket(sessionId: string): WAClientSocket | null {
    return this.manager.getSocket(sessionId);
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.manager.disconnect(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.manager.delete(sessionId);
  }

  listSessions(): SessionInfo[] {
    return this.manager.listSessions();
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
    return this.manager.subscribe(sessionId, event, subscriber);
  }

  async restoreAll(): Promise<void> {
    await this.manager.restoreAll();
  }

  sessionExistsOnDisk(sessionId: string): boolean {
    return officialSessionExistsOnDisk(sessionId);
  }
}

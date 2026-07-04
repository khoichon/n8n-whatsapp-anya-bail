import type { WAClientSocket } from './SocketInterface';
import type {
  BackendCapabilities,
  BackendId,
  CreateSessionOptions,
  EventSubscriber,
  SessionInfo,
  WhatsAppEventName,
} from './Types';

/**
 * IWhatsAppBackend
 * ─────────────────
 * The single seam between n8n nodes and a concrete WhatsApp SDK.
 * Nodes MUST NOT import `anya-bail` or `baileys` directly — only this
 * interface (obtained via the BackendResolver) and the backend-agnostic
 * `WAClientSocket` structural type.
 *
 *   IWhatsAppBackend
 *   ├── LegacyBackend    (wraps the pre-existing SessionManager/anya-bail)
 *   └── OfficialBackend  (wraps the official `baileys` package)
 */
export interface IWhatsAppBackend {
  readonly id: BackendId;
  readonly capabilities: BackendCapabilities;

  /** Create (or return the existing) session/connection. */
  connect(options: CreateSessionOptions): Promise<void>;

  /** Returns the live socket for a session, throwing if not connected. */
  getOrThrowSocket(sessionId: string): WAClientSocket;

  /** Returns the live socket for a session, or null if not connected. */
  getSocket(sessionId: string): WAClientSocket | null;

  disconnect(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(): SessionInfo[];
  getSessionInfo(sessionId: string): SessionInfo | undefined;

  getQR(sessionId: string): string | undefined;
  getPairingCode(sessionId: string): string | undefined;

  /** Rolling trail of pairing-code attempt events (connection.update
   *  states, sanitised phone used, success/error), for surfacing in the
   *  node's output JSON when generation fails or behaves unexpectedly. */
  getPairingDebug(sessionId: string): string[];

  /** Whether persisted auth files exist on disk for this session (used by "Get Status"). */
  sessionExistsOnDisk(sessionId: string): boolean;

  subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void;

  /** Restores all persisted sessions for this backend (called at bootstrap). */
  restoreAll(): Promise<void>;
}

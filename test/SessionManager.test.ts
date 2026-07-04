=== shared/Types.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/Types.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/Types.ts	2026-07-03 14:04:30.591213656 +0000
@@ -18,6 +18,11 @@
   qrCode?: string;
   qrImagePath?: string;
   pairingCode?: string;
+  /** Rolling trail of what happened during the last pairing-code attempt,
+   *  surfaced by the WhatsApp Login node's "Generate Pairing Code"
+   *  operation so it's visible in the n8n UI without needing server log
+   *  access. */
+  pairingDebug?: string[];
   connectionState: Partial<ConnectionState>;
   reconnectTimer?: NodeJS.Timeout;
   isReconnecting: boolean;

=== shared/Utils.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/Utils.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/Utils.ts	2026-07-03 08:59:10.105923086 +0000
@@ -13,6 +13,17 @@
   return `${clean}@s.whatsapp.net`;
 }
 
+/**
+ * Normalise a user-supplied phone number for Baileys' `requestPairingCode()`.
+ * Baileys builds a JID directly from this string (`${digits}@s.whatsapp.net`),
+ * so a leading "+", spaces or dashes — all of which the WhatsApp Login node's
+ * "Phone Number" field explicitly invites via its `+1234567890` placeholder —
+ * produce an invalid JID and the pairing-code request silently fails.
+ */
+export function normalisePhoneForPairing(input: string): string {
+  return (input || '').replace(/[^0-9]/g, '');
+}
+
 export function normaliseGroupJid(input: string): string {
   if (!input) return '';
   if (input.includes('@g.us')) return input;

=== shared/SessionManager.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/SessionManager.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/SessionManager.ts	2026-07-03 14:04:57.340965693 +0000
@@ -30,7 +30,7 @@
   CreateSessionOptions,
   EventSubscriber,
 } from './Types';
-import { sleep } from './Utils';
+import { sleep, normalisePhoneForPairing } from './Utils';
 
 export class SessionManager {
   
@@ -121,6 +121,18 @@
     return this.sessions.get(sessionId)?.pairingCode;
   }
 
+  /** Rolling trail of pairing-code attempt events, for the node to surface
+   *  in its output JSON (visible in the n8n UI) when generation fails. */
+  getPairingDebug(sessionId: string): string[] {
+    return this.sessions.get(sessionId)?.pairingDebug ?? [];
+  }
+
+  private _debug(state: SessionState, message: string): void {
+    if (!state.pairingDebug) state.pairingDebug = [];
+    state.pairingDebug.push(`[${new Date().toISOString()}] ${message}`);
+    if (state.pairingDebug.length > 50) state.pairingDebug.shift();
+  }
+
   subscribe(
     sessionId: string,
     event: SupportedEvent,
@@ -159,6 +171,7 @@
         isReconnecting: false,
         subscribers: new Map(),
         bus: new EventBus(sessionId),
+        pairingDebug: [],
       } as SessionState & { bus: EventBus };
       this.sessions.set(sessionId, state);
     }
@@ -181,6 +194,15 @@
     sessionState.isReconnecting = false;
     sessionState.qrCode = undefined;
     sessionState.pairingCode = undefined;
+    sessionState.pairingDebug = [];
+
+    if (usePairingCode) {
+      this._debug(
+        sessionState,
+        `connect() called with usePairingCode=true, phone="${pairingPhone ?? ''}", ` +
+          `creds.registered=${Boolean((authState as { creds?: { registered?: boolean } }).creds?.registered)}`,
+      );
+    }
 
     const sock = makeWASocket({
       auth: authState,
@@ -206,6 +228,16 @@
       Object.assign(sessionState.connectionState, update);
       sessionState.bus?.publish('connection.update', update);
 
+      if (usePairingCode) {
+        const disconnectMsg = lastDisconnect?.error
+          ? ` lastDisconnect="${(lastDisconnect.error as Error).message}"`
+          : '';
+        this._debug(
+          sessionState,
+          `connection.update: connection="${connection ?? ''}" qr=${qr ? 'present' : 'none'}${disconnectMsg}`,
+        );
+      }
+
       if (qr) {
         sessionState.qrCode = qr;
         try {
@@ -213,12 +245,21 @@
         } catch { /* non-critical */ }
         logger.info('QR code generated');
 
+        // Matches upstream Baileys' own reference usage (Example/example.ts):
+        // requestPairingCode() must be called after the socket has produced
+        // a `qr` ref (i.e. the handshake has completed) — calling it earlier
+        // throws "Connection Closed". The phone number must be digits only;
+        // WhatsApp rejects "+", spaces and dashes silently.
         if (usePairingCode && pairingPhone) {
+          const sanitisedPhone = normalisePhoneForPairing(pairingPhone);
+          this._debug(sessionState, `Requesting pairing code for phone="${sanitisedPhone}"`);
           try {
-            const code = await sock.requestPairingCode(pairingPhone);
+            const code = await sock.requestPairingCode(sanitisedPhone);
             sessionState.pairingCode = code;
+            this._debug(sessionState, `Pairing code received: "${code}"`);
             logger.info('Pairing code generated', { code });
           } catch (e) {
+            this._debug(sessionState, `requestPairingCode() threw: ${(e as Error).message}`);
             logger.error('Failed to generate pairing code', e);
           }
         }

=== shared/backends/OfficialSessionManager.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/backends/OfficialSessionManager.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/backends/OfficialSessionManager.ts	2026-07-03 14:05:33.809323825 +0000
@@ -5,6 +5,7 @@
 import { loadOfficialBaileys } from './BaileysModuleLoader';
 import { BackendEventBus } from './BackendEventBus';
 import { makeSessionDirHelpers, JsonMetadataStore, generateQRImageFile, ensureDir } from './StorageKit';
+import { normalisePhoneForPairing } from '../Utils';
 import type { WAClientSocket } from './SocketInterface';
 import type { CreateSessionOptions, SessionInfo, WhatsAppEventName, EventSubscriber } from './Types';
 
@@ -39,6 +40,7 @@
   metadata: OfficialMetadata;
   qrCode?: string;
   pairingCode?: string;
+  pairingDebug?: string[];
   isReconnecting: boolean;
   reconnectTimer?: NodeJS.Timeout;
   bus: BackendEventBus;
@@ -143,6 +145,18 @@
     return this.sessions.get(sessionId)?.pairingCode;
   }
 
+  /** Rolling trail of pairing-code attempt events, for the node to surface
+   *  in its output JSON (visible in the n8n UI) when generation fails. */
+  getPairingDebug(sessionId: string): string[] {
+    return this.sessions.get(sessionId)?.pairingDebug ?? [];
+  }
+
+  private _debug(state: OfficialSessionState, message: string): void {
+    if (!state.pairingDebug) state.pairingDebug = [];
+    state.pairingDebug.push(`[${new Date().toISOString()}] ${message}`);
+    if (state.pairingDebug.length > 50) state.pairingDebug.shift();
+  }
+
   subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
     const state = this._getOrCreateState(sessionId);
     return state.bus.subscribe(event, subscriber);
@@ -191,6 +205,15 @@
     sessionState.isReconnecting = false;
     sessionState.qrCode = undefined;
     sessionState.pairingCode = undefined;
+    sessionState.pairingDebug = [];
+
+    if (usePairingCode) {
+      this._debug(
+        sessionState,
+        `connect() called with usePairingCode=true, phone="${pairingPhone ?? ''}", ` +
+          `creds.registered=${Boolean((authState as { creds?: { registered?: boolean } }).creds?.registered)}`,
+      );
+    }
 
     const sock: WAClientSocket = baileys.default({
       auth: authState,
@@ -217,6 +240,16 @@
       };
       sessionState.bus.publish('connection.update', update);
 
+      if (usePairingCode) {
+        const disconnectMsg = lastDisconnect?.error
+          ? ` lastDisconnect="${(lastDisconnect.error as Error).message}"`
+          : '';
+        this._debug(
+          sessionState,
+          `connection.update: connection="${connection ?? ''}" qr=${qr ? 'present' : 'none'}${disconnectMsg}`,
+        );
+      }
+
       if (qr) {
         sessionState.qrCode = qr;
         try {
@@ -226,11 +259,20 @@
         }
         log('info', sessionId, 'QR code generated');
 
+        // Matches upstream Baileys' own reference usage (Example/example.ts):
+        // requestPairingCode() must be called after the socket has produced
+        // a `qr` ref (i.e. the handshake has completed) — calling it earlier
+        // throws "Connection Closed". The phone number must be digits only;
+        // WhatsApp rejects "+", spaces and dashes silently.
         if (usePairingCode && pairingPhone) {
+          const sanitisedPhone = normalisePhoneForPairing(pairingPhone);
+          this._debug(sessionState, `Requesting pairing code for phone="${sanitisedPhone}"`);
           try {
-            sessionState.pairingCode = await sock.requestPairingCode(pairingPhone);
+            sessionState.pairingCode = await sock.requestPairingCode(sanitisedPhone);
+            this._debug(sessionState, `Pairing code received: "${sessionState.pairingCode}"`);
             log('info', sessionId, 'Pairing code generated');
           } catch (e) {
+            this._debug(sessionState, `requestPairingCode() threw: ${(e as Error).message}`);
             log('error', sessionId, 'Failed to generate pairing code', (e as Error).message);
           }
         }

=== shared/backends/IWhatsAppBackend.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/backends/IWhatsAppBackend.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/backends/IWhatsAppBackend.ts	2026-07-03 14:05:38.615063313 +0000
@@ -41,6 +41,11 @@
   getQR(sessionId: string): string | undefined;
   getPairingCode(sessionId: string): string | undefined;
 
+  /** Rolling trail of pairing-code attempt events (connection.update
+   *  states, sanitised phone used, success/error), for surfacing in the
+   *  node's output JSON when generation fails or behaves unexpectedly. */
+  getPairingDebug(sessionId: string): string[];
+
   /** Whether persisted auth files exist on disk for this session (used by "Get Status"). */
   sessionExistsOnDisk(sessionId: string): boolean;
 

=== shared/backends/LegacyBackend.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/backends/LegacyBackend.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/backends/LegacyBackend.ts	2026-07-03 14:05:42.061498625 +0000
@@ -69,6 +69,10 @@
     return this.manager.getPairingCode(sessionId);
   }
 
+  getPairingDebug(sessionId: string): string[] {
+    return this.manager.getPairingDebug(sessionId);
+  }
+
   subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
     // The legacy SUPPORTED_EVENTS union is a subset of WhatsAppEventName;
     // events outside that subset simply never fire for this backend.

=== shared/backends/OfficialBackend.ts ===
--- orig/n8n-whatsapp-anya-bail-master/shared/backends/OfficialBackend.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/shared/backends/OfficialBackend.ts	2026-07-03 14:05:45.276376134 +0000
@@ -61,6 +61,10 @@
     return this.manager.getPairingCode(sessionId);
   }
 
+  getPairingDebug(sessionId: string): string[] {
+    return this.manager.getPairingDebug(sessionId);
+  }
+
   subscribe(sessionId: string, event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
     return this.manager.subscribe(sessionId, event, subscriber);
   }

=== nodes/WhatsAppLogin/WhatsAppLogin.node.ts ===
--- orig/n8n-whatsapp-anya-bail-master/nodes/WhatsAppLogin/WhatsAppLogin.node.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/nodes/WhatsAppLogin/WhatsAppLogin.node.ts	2026-07-03 14:05:52.270013987 +0000
@@ -163,6 +163,10 @@
               pairingCode: code ?? null,
               phone,
               message: code ? 'Enter this code in WhatsApp > Linked Devices > Link a Device' : 'Pairing code not yet generated',
+              // Visible in the n8n UI's output panel — shows exactly what
+              // the socket did (or didn't do) during this attempt, since
+              // server-side console/log output isn't reachable from there.
+              debug: backend.getPairingDebug(sessionId),
             },
           });
           continue;

=== test/SessionManager.test.ts ===
--- orig/n8n-whatsapp-anya-bail-master/test/SessionManager.test.ts	2026-07-03 08:02:56.000000000 +0000
+++ repo/n8n-whatsapp-anya-bail-master/test/SessionManager.test.ts	2026-07-03 09:29:48.560310465 +0000
@@ -7,6 +7,7 @@
 
 import { SessionManager } from '../shared/SessionManager';
 import { MetadataStore } from '../shared/MetadataStore';
+import makeWASocket from 'anya-bail';
 
 jest.mock('anya-bail', () => ({
   __esModule: true,
@@ -18,10 +19,11 @@
     user: { id: '1234567890:1@s.whatsapp.net', name: 'Test User' },
     logout: jest.fn(),
     end: jest.fn(),
+    requestPairingCode: jest.fn().mockResolvedValue('ABC-123'),
   })),
   DisconnectReason: { loggedOut: 401 },
   useMultiFileAuthState: jest.fn().mockResolvedValue({
-    state: {},
+    state: { creds: { registered: false } },
     saveCreds: jest.fn(),
   }),
   fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0], isLatest: true }),
@@ -114,6 +116,47 @@
     expect(typeof unsub).toBe('function');
     unsub();
   });
+
+  it('requests a pairing code once a "qr" ref is received, using a digits-only phone number', async () => {
+    const state = await manager.create({
+      sessionId: 'pairing-test',
+      usePairingCode: true,
+      pairingPhone: '+1 (234) 567-8900',
+    });
+
+    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
+    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
+      ([event]: [string]) => event === 'connection.update',
+    )!;
+
+    // Simulate WhatsApp emitting the QR ref, which is what the pairing
+    // code request piggybacks on (see shared/SessionManager.ts).
+    await connectionUpdateHandler({ qr: 'test-qr-ref' });
+
+    expect(socket.requestPairingCode).toHaveBeenCalledWith('12345678900');
+    expect(manager.getPairingCode('pairing-test')).toBe('ABC-123');
+    expect(state.pairingCode).toBe('ABC-123');
+  });
+
+  it('does not request a pairing code before a "qr" ref has been received', async () => {
+    await manager.create({
+      sessionId: 'no-qr-yet-test',
+      usePairingCode: true,
+      pairingPhone: '1234567890',
+    });
+    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
+    expect(socket.requestPairingCode).not.toHaveBeenCalled();
+  });
+
+  it('does not request a pairing code when usePairingCode is not set', async () => {
+    await manager.create({ sessionId: 'no-pairing-test' });
+    const socket = (makeWASocket as jest.Mock).mock.results.at(-1)!.value;
+    const [, connectionUpdateHandler] = (socket.ev.on as jest.Mock).mock.calls.find(
+      ([event]: [string]) => event === 'connection.update',
+    )!;
+    await connectionUpdateHandler({ qr: 'test-qr-ref' });
+    expect(socket.requestPairingCode).not.toHaveBeenCalled();
+  });
 });
 
 describe('EventBus', () => {
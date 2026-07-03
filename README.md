# n8n-nodes-whatsapp-baileys

A production-ready n8n community node package integrating WhatsApp, with a
pluggable backend layer supporting both the legacy
[`anya-bail`](https://www.npmjs.com/package/anya-bail) fork and **official
[Baileys](https://www.npmjs.com/package/baileys)** — selectable per
credential, and overridable per node.

**Upgrading from a previous version? Nothing changes for you by default.**
See [Migration Guide](#migration-guide) below.

---

## What's new in this version

- **Dual backend support**: Legacy (`anya-bail`) and Official Baileys, chosen
  via a `Backend` field on the existing `WhatsApp Session` credential.
- **Zero breaking changes**: existing credentials, workflows, node names,
  parameter names, and JSON outputs are unchanged. `Backend` defaults to
  `Legacy`.
- **Per-node Backend Override**: every node has an advanced, optional
  "Backend Override" dropdown for testing/gradual migration, defaulting to
  "Use Credential Setting".
- **Capability Registry**: nodes check what the active backend actually
  supports before running an operation and fail with a clear, actionable
  error instead of silently doing nothing.
- **Mentions in WhatsApp Send**: new "Mention Users" / "Mention All Group
  Participants" fields for Text, Image and Video messages.
- **Broader event coverage** in Trigger/Events: `messages.reaction`,
  `message-receipt.update` added alongside the existing event set.

---

## Features

- **Two interchangeable backends** behind one abstraction — see
  [Architecture](#architecture)
- **Multiple simultaneous sessions** — manage many WhatsApp accounts at once,
  on either backend, at the same time
- **QR and Pairing Code auth** — flexible authentication options
- **Persistent storage** — sessions survive n8n and server restarts
- **Auto-reconnect** — exponential backoff, up to 10 attempts
- **Singleton sockets** — one socket per session, shared across all nodes
- **Central EventBus** — multiple Trigger nodes subscribe without extra WA connections
- **Full anya-bail / Baileys API** — interactive buttons, lists, polls, calls,
  rich messages, mentions
- **Raw node** — write arbitrary JavaScript against any socket method, on
  either backend

---

## Nodes Included

| Node | Purpose |
|---|---|
| **WhatsApp Login** | Connect, QR/pairing code, status, disconnect, delete |
| **WhatsApp Send** | Text, image, video, audio, voice, document, sticker, location, contact, poll, reaction, buttons, lists, mentions, forward, delete, edit, pin |
| **WhatsApp Group** | Create, join, leave, manage members, settings, invites |
| **WhatsApp Profile** | Status, picture, name, block/unblock, business profile, privacy |
| **WhatsApp Query** | Check existence, contacts, chats, groups, devices, blocklist, presence |
| **WhatsApp Trigger** | Event-driven: messages, media, edits, deletes, reactions, receipts, groups, calls, connection |
| **WhatsApp Events** | Wait for and capture the next event of a specific type |
| **WhatsApp Raw** | Execute raw JavaScript against the active backend's socket |

Every node above (except Raw) consults the **Capability Registry** and
throws a descriptive `NodeOperationError` — naming the backend, the feature,
and a suggested fix — instead of silently no-oping when a feature isn't
supported by the active backend.

---

## Installation

### In n8n (recommended)

```bash
# From your n8n installation directory
npm install n8n-nodes-whatsapp-baileys
```

Or via the n8n GUI: **Settings → Community Nodes → Install** → enter `n8n-nodes-whatsapp-baileys`.

This installs both `anya-bail` and `baileys` as dependencies — you don't need
to install the official SDK separately, even if you only ever use the
default (Legacy) backend.

### For development

```bash
git clone https://github.com/your-org/n8n-nodes-whatsapp-baileys.git
cd n8n-nodes-whatsapp-baileys
npm install
npm run build
npm link

# In your n8n directory
npm link n8n-nodes-whatsapp-baileys
```

---

## Quick Start

### 1. Connecting a Session

1. Create a **WhatsApp Session** credential. Leave **Backend** on `Legacy`
   unless you specifically want to try Official Baileys (see below).
2. Add a **WhatsApp Login** node to your workflow.
3. Set **Operation** → `Connect / Get QR`.
4. Give your session a unique **Session ID** (e.g. `my-account`).
5. Execute the node — it returns a QR code as text and as a binary image.
6. Scan the QR with WhatsApp → **Settings → Linked Devices → Link a Device**.
7. Re-execute to confirm the session is connected.

### 2. Sending a Message (with a mention)

```
WhatsApp Login → WhatsApp Send
```

In **WhatsApp Send**:
- Session ID: `my-account`
- Operation: `Text`
- To: `+1234567890` (or a group JID ending in `@g.us`)
- Text: `Hi @1234567890, welcome!`
- Mention Users: `+1234567890`

The phone number(s) in **Mention Users** (or every participant, if **Mention
All Group Participants** is enabled for a group chat) get the WhatsApp
@-mention highlight. The number must also appear in the message text itself
for WhatsApp clients to render the mention visually — this field controls
who is tagged/notified, not what's displayed.

### 3. Triggering on Incoming Messages

Add a **WhatsApp Trigger** node:
- Session ID: `my-account`
- Trigger Mode: `Incoming Message`

The workflow fires each time a message arrives — regardless of which backend
the session is using.

### 4. Trying Official Baileys

1. Open your **WhatsApp Session** credential and set **Backend** →
   `Official Baileys`.
2. Every node using that credential now connects through the official
   `baileys` package instead of `anya-bail`. Official-backend sessions are
   stored completely separately (`~/.n8n/whatsapp-official/`), so you'll
   need to scan a fresh QR code the first time — see
   [Migration Guide](#migration-guide).
3. To test just one node against the other backend without changing the
   credential, use that node's **Backend Override** field instead.

### 5. Raw API Access

Use **WhatsApp Raw** to call any socket method directly. The `backend`
variable tells you which SDK you're talking to:

```javascript
// Fetch all groups (works on both backends)
const groups = await sock.groupFetchAllParticipating();
return Object.values(groups);
```

```javascript
// anya-bail-exclusive: AI icon message
if (backend !== 'legacy') {
  throw new Error('AI icon is a Legacy (anya-bail) exclusive feature');
}
await sock.sendMessage('1234567890@s.whatsapp.net', { text: 'I am a bot!' }, { ai: true });
return { sent: true };
```

---

## Architecture

### Old architecture (pre-upgrade)

```
nodes/*.node.ts
      |
      v  (direct import)
shared/SessionManager.ts  --makeWASocket()-->  anya-bail
      |
      +-- shared/GroupHelpers.ts    (typed against anya-bail's WASocket)
      +-- shared/ProfileHelpers.ts  (typed against anya-bail's WASocket)
      +-- shared/MessageHelpers.ts  (typed against anya-bail's AnyMessageContent/WAMessage)
```

Every node imported `SessionManager` directly and called
`manager.getOrThrow(sessionId)` to get a real `anya-bail` `WASocket`. There
was exactly one backend, hard-wired throughout the codebase, with no seam to
add a second one without touching every node.

### New architecture

```
                         nodes/*.node.ts
                               |
                               v
              shared/backends/BackendResolver.ts
        (inspects node override -> credential -> default)
                               |
                 +-------------+-------------+
                 v                           v
     shared/backends/LegacyBackend   shared/backends/OfficialBackend
     (adapter, delegates to the      (adapter, delegates to the NEW
      pre-existing, UNMODIFIED       OfficialSessionManager, which
      SessionManager.ts)             drives the official `baileys`
                 |                    package via dynamic import)
                 v                           v
          anya-bail WASocket          official baileys WASocket
                 |                           |
                 +-------------+-------------+
                               v
      Both satisfy shared/backends/SocketInterface.ts's
      WAClientSocket -- a structural type covering exactly the
      methods this package calls. Because both SDKs share the
      same WhiskeySockets/Baileys lineage, the pre-existing
      GroupHelpers.ts / ProfileHelpers.ts / MessageHelpers.ts run
      UNMODIFIED against either socket.
                               |
                               v
       shared/backends/CapabilityRegistry.ts is consulted by
       nodes before any backend-exclusive operation, throwing a
       descriptive NodeOperationError if unsupported.
```

Key design decisions:

- **`IWhatsAppBackend`** (`shared/backends/IWhatsAppBackend.ts`) is the only
  interface nodes are allowed to depend on. No node file imports `anya-bail`
  or `baileys` types directly anymore (`WhatsAppRaw` is the sole intentional
  exception, by design — see below).
- **`LegacyBackend` is a thin, behaviour-preserving adapter.**
  `shared/SessionManager.ts`, `SessionStore.ts`, `MetadataStore.ts`,
  `EventBus.ts`, `QRGenerator.ts` and the legacy `Types.ts` are **completely
  unmodified**. Any workflow that never touches the new `Backend`
  credential field or the "Backend Override" node field runs through
  exactly the same code it did before this upgrade.
- **`OfficialBackend` is a new, independent implementation**
  (`OfficialSessionManager.ts`) that mirrors `SessionManager.ts`'s
  reconnect/session-lifecycle logic against the official `baileys` package.
  It intentionally does **not** share a class with the legacy manager — the
  guiding principle here was "prioritize compatibility over rewriting":
  refactoring the tested, working `SessionManager.ts` into a generic
  multi-backend engine was judged riskier than writing a parallel,
  independent implementation.
- **Storage isolation.** Official-backend sessions live under a completely
  separate directory tree (`~/.n8n/whatsapp-official/` vs. the legacy
  `~/.n8n/whatsapp/`), with their own `metadata.json`, logs, and QR cache.
  This guarantees the two backends' auth state can never collide, be
  partially overwritten, or corrupt each other, even though their on-disk
  formats are similar.
- **Dynamic import for official Baileys.** `baileys` (like `anya-bail`)
  ships as `"type": "module"` with no CommonJS entry point. This project's
  build stays CommonJS (`tsconfig.json` unchanged) to avoid a much larger,
  riskier migration of the whole toolchain — so
  `shared/backends/BaileysModuleLoader.ts` loads it via a cached dynamic
  `import()`, which works from CommonJS regardless of Node version, instead
  of `require()`, which would throw `ERR_REQUIRE_ESM`.
- **WhatsApp Raw is the one deliberate exception to the abstraction.** It's
  meant as a full escape hatch to the real SDK, so it exposes the real
  `sock` for whichever backend is active, plus a `backend` variable so your
  code can branch. This means backend-exclusive methods (e.g. anya-bail's
  `sendTable`, `initiateCall`, the `{ ai: true }` flag) will throw "not a
  function" if called against the wrong backend from a Raw node — this is
  expected and matches how a raw/advanced escape hatch should behave.

---

## Files Modified / Added

### Added (new backend abstraction layer)

| File | Why |
|---|---|
| `shared/backends/Types.ts` | Core backend-agnostic types (capabilities, event names, session info) |
| `shared/backends/SocketInterface.ts` | Structural `WAClientSocket` type both SDKs satisfy |
| `shared/backends/IWhatsAppBackend.ts` | The interface every backend implements; the only thing nodes depend on |
| `shared/backends/CapabilityRegistry.ts` | Per-backend feature flags + descriptive unsupported-operation errors |
| `shared/backends/assertCapability.ts` | Node-facing helper that throws `NodeOperationError` for unsupported features |
| `shared/backends/LegacyBackend.ts` | Thin adapter over the pre-existing, unmodified `SessionManager` |
| `shared/backends/OfficialBackend.ts` | Adapter over the new `OfficialSessionManager` |
| `shared/backends/OfficialSessionManager.ts` | Connection/session lifecycle for official `baileys` (mirrors `SessionManager.ts`) |
| `shared/backends/BaileysModuleLoader.ts` | Cached dynamic `import()` loader for the ESM-only `baileys` package |
| `shared/backends/BackendEventBus.ts` | Generic per-session event fan-out for the official backend |
| `shared/backends/StorageKit.ts` | Namespaced session/metadata/QR storage utilities for the official backend |
| `shared/backends/BackendResolver.ts` | Central resolution: node override → credential → default; singleton reuse |
| `shared/backends/index.ts` | Barrel export |

### Modified

| File | Change | Why |
|---|---|---|
| `credentials/WhatsAppSession.credentials.ts` | Added `Backend` options field (default `Legacy`) | Extend, don't duplicate, the existing credential type |
| `shared/GroupHelpers.ts` | Import type changed from `anya-bail`'s `WASocket` to `WAClientSocket` | Type-only change (zero runtime difference) so the same helper works against either backend's socket |
| `shared/ProfileHelpers.ts` | Same type-only change as above | Same reason |
| `shared/MessageHelpers.ts` | `AnyMessageContent`/`WAMessage` redefined as backend-agnostic structural types; `buildTextContent`/`buildImageContent`/`buildVideoContent` gained an optional trailing `mentions?: string[]` parameter | Decouple from the SDK type; add mentions support without breaking any existing call site (parameter is optional and trailing) |
| `shared/Bootstrap.ts` | Additionally calls `OfficialSessionManager.restoreAll()` | Restore persisted official-backend sessions at startup, alongside (not instead of) the legacy restore |
| `nodes/*.node.ts` (all 8) | Rewired to resolve a backend via `BackendResolver` instead of importing `SessionManager` directly; added the "Backend Override" property; added capability checks before backend-exclusive operations | Core of the upgrade — see [Architecture](#architecture) |
| `package.json` | Added `baileys` dependency | Official backend needs it installed |
| `jest.config.js` *(new)* | Wires up `ts-jest` | The repo had `ts-jest` as a devDependency but no Jest config, so `npm test` silently failed to parse TypeScript before this change (pre-existing gap, unrelated to this upgrade, fixed while verifying the build) |
| `test/SessionManager.test.ts` | Mock gained `fetchLatestBaileysVersion` and `__esModule: true` | The existing mock predated a call to `fetchLatestBaileysVersion()` in `SessionManager.ts` and had an `esModuleInterop` mismatch; both were pre-existing gaps only visible once Jest was actually wired up (see above) |
| `test/CapabilityRegistry.test.ts`, `test/BackendResolver.test.ts` *(new)* | New coverage for the added abstraction layer | |

**Files intentionally left untouched:** `shared/SessionManager.ts`,
`shared/SessionStore.ts`, `shared/MetadataStore.ts`, `shared/EventBus.ts`,
`shared/QRGenerator.ts`, `shared/Types.ts`, `shared/Constants.ts`,
`shared/Logger.ts`, `shared/Utils.ts`, `index.ts`, `gulpfile.js`,
`tsconfig.json` (only additive), `nodes/whatsapp.svg`.

---

## Migration Guide

### If you do nothing

Nothing changes. `Backend` on your existing credential(s) defaults to
`Legacy`, every node's "Backend Override" defaults to "Use Credential
Setting", and all of that code path is byte-for-byte the same as before this
upgrade. Your existing sessions in `~/.n8n/whatsapp/` are read exactly as
they were.

### If you want to try Official Baileys

1. **This is not an in-place upgrade of your existing session** — official
   Baileys and anya-bail have different (though similar) auth-state formats,
   and this package deliberately stores them in separate directory trees to
   avoid any risk of corrupting your existing, working legacy session. You
   will need to scan a new QR code / generate a new pairing code the first
   time you connect a session on the Official backend, even if you reuse the
   same **Session ID** string.
2. Duplicate your **WhatsApp Session** credential (or create a new one), and
   set **Backend** → `Official Baileys` on the copy.
3. Point one workflow (or one node, via **Backend Override**) at the new
   credential and connect via **WhatsApp Login**.
4. Verify the operations you rely on. Everything in the
   [Capability Registry](#capability-registry) table below marked ✅ for
   Official Baileys is expected to work identically. Anything marked ❌ will
   raise a clear `NodeOperationError` telling you to switch backends rather
   than fail silently.
5. Once you're confident, either switch your original credential's
   **Backend** field to `Official Baileys` (all nodes using it will pick it
   up automatically) or migrate workflow-by-workflow using **Backend
   Override**.

### Rolling back

Set **Backend** back to `Legacy` (or "Backend Override" back to "Use
Credential Setting" / `Legacy`) — the legacy session data was never touched,
so it's still there and still connected.

---

## Capability Registry

| Feature | Legacy (anya-bail) | Official Baileys |
|---|:---:|:---:|
| Messaging | Yes | Yes |
| Media messages | Yes | Yes |
| Polls | Yes | Yes |
| Reactions | Yes | Yes |
| Presence updates | Yes | Yes |
| Message editing | Yes | Yes |
| Status / about text | Yes | Yes |
| Interactive buttons | Yes | Yes |
| List messages | Yes | Yes |
| Group management | Yes | Yes |
| QR code login | Yes | Yes |
| Pairing code login | Yes | Yes |
| Business profile | Yes | Yes |
| Privacy settings | Yes | Yes |
| Blocklist | Yes | Yes |
| Voice/video calls | Yes | No |
| Channel administration | No | No |
| Newsletter administration | No | No |
| AI icon badge | Yes (exclusive) | No |
| Rich table messages | Yes (exclusive) | No |
| Raw socket access | Yes | Yes |

Channel/newsletter administration is off for **both** backends in this
release — recent official Baileys versions do expose newsletter APIs, but
they haven't been verified against this package's node surface yet. See
[Future Improvements](#future-improvements).

---

## Storage Layout

### Legacy backend (unchanged)

```
~/.n8n/whatsapp/
+-- sessions/
|   +-- default/           # Multi-file auth state for "default" session
|   |   +-- creds.json
|   |   +-- *.json
|   +-- my-account/
+-- logs/
|   +-- system.log
|   +-- my-account.log
+-- cache/
|   +-- qr/
|       +-- my-account.bmp
+-- metadata.json          # Session metadata index
```

### Official backend (new, isolated tree)

```
~/.n8n/whatsapp-official/
+-- sessions/
|   +-- my-account/
+-- logs/
|   +-- my-account.log
+-- cache/
|   +-- qr/
|       +-- my-account.bmp
+-- metadata.json
```

Sessions on either backend persist across n8n restarts, server reboots, and
workflow changes. No QR re-scanning is needed unless you explicitly delete a
session or log out from WhatsApp.

---

## Credentials

The **WhatsApp Session** credential type is unchanged in name and every
pre-existing field; one field was added:

| Field | Description |
|---|---|
| **Backend** *(new)* | `Legacy` (default) or `Official Baileys` |
| Session ID | Unique identifier for this account |
| Authentication Method | QR Code or Pairing Code |
| Phone Number | Required for Pairing Code auth |
| Auto-Reconnect | Reconnect automatically on disconnect |
| Session Storage Path | Override the default storage path |

---

## anya-bail Exclusive Features

These remain available on the Legacy backend via **WhatsApp Raw** or
dedicated operations:

```javascript
// AI icon on any message
await sock.sendMessage(jid, { text: 'Hello!' }, { ai: true });

// Rich table message
await sock.sendTable(jid, 'Title', ['Col1','Col2'], [['a','b']], null, {});

// Initiate a call
const { callId } = await sock.initiateCall(jid, { isVideo: false });
```

---

## Troubleshooting

**"Operation not supported on backend..."** — You're calling a feature the
active backend doesn't declare support for (see the
[Capability Registry](#capability-registry) table). The error message
includes a suggestion for which backend to switch to, if any.

**QR code doesn't appear / times out** — Increase "Wait For QR (seconds)" on
the WhatsApp Login node. Also check `~/.n8n/whatsapp/logs/<session>.log`
(legacy) or `~/.n8n/whatsapp-official/logs/<session>.log` (official) for
connection errors.

**"Failed to load the official baileys package"** — Run `npm install` in
your n8n installation directory to make sure `baileys` was installed
alongside this package.

**Switched Backend on my credential and now I'm asked to scan a QR again** —
Expected. Official Baileys sessions are stored separately from Legacy
sessions by design (see [Migration Guide](#migration-guide)); your Legacy
session and its data are untouched.

**Raw node throws "sock.sendTable is not a function"** — That method is
anya-bail-exclusive. Check the `backend` variable available in the Raw
node's code, or switch that node's Backend Override to `Legacy`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WA_DEBUG` | `0` | Set to `1` to enable verbose console logging (both backends) |

---

## Development

```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm run lint       # ESLint
npm test           # Jest tests
```

---

## Future Improvements

- Verify and enable official Baileys' newsletter/channel administration APIs
  against this package's `WhatsAppGroup`/`WhatsAppQuery` node surface, then
  flip `newsletters`/`channels` on in the Capability Registry.
- Evaluate whether `LegacyBackend` and `OfficialBackend` can be more deeply
  unified (shared reconnect/backoff engine) now that the parallel
  implementation has proven the socket-interface abstraction works, without
  reintroducing risk to the tested legacy path.
- Optional automatic migration tool: copy/convert a Legacy session's
  multi-file auth state into an Official-backend session directory where the
  underlying credential formats allow it, to avoid re-scanning a QR code
  when switching backends.
- Add an `eslint` config (the `lint`/`lintfix` scripts reference ESLint, but
  no `.eslintrc` ships in the repository — a pre-existing gap, not
  introduced by this upgrade).
- Expand automated test coverage for `OfficialSessionManager`'s
  connect/reconnect logic (currently exercised only indirectly, since
  mocking the dynamic `import('baileys')` call reliably in Jest needs a
  dedicated harness beyond this upgrade's scope).

---

## License

MIT — see [LICENSE](LICENSE).

> Legacy backend based on [anya-bail](https://www.npmjs.com/package/anya-bail).
> Official backend based on [baileys](https://www.npmjs.com/package/baileys).
> Both are forks/distributions of [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys).
> Not affiliated with WhatsApp or Meta.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an n8n community node package that provides WhatsApp integration through multiple backend SDKs. The package uses a backend abstraction layer to support both `anya-bail` (a fork with exclusive features) and official `@whiskeysockets/baileys`.

### Core Architecture

**Backend Abstraction Layer**: The entire node suite is built on a backend-agnostic interface (`IWhatsAppBackend`) defined in `shared/backends/IWhatsAppBackend.ts`. Nodes never import `anya-bail` or `baileys` directly — they interact through `BackendResolver` which returns the appropriate backend instance based on credential settings or node-level overrides.

**Backend Resolution Priority**:
1. Node's "Backend Override" parameter (if not "Use Credential Setting")
2. Credential's "Backend" field
3. Default: "legacy" (pre-upgrade behavior)

**Two Backend Implementations**:
- **LegacyBackend** (`shared/backends/LegacyBackend.ts`): Wraps `SessionManager` → `anya-bail`
- **OfficialBackend** (`shared/backends/OfficialBackend.ts`): Wraps `OfficialSessionManager` → official `baileys`

**Capability System**: Each backend declares `BackendCapabilities` (messages, media, polls, calls, etc.). Nodes use `assertCapability()` before operations to fail loudly with helpful errors when features aren't supported on the active backend.

### Session Management

**SessionManager** (`shared/SessionManager.ts`) is a singleton that manages WhatsApp socket connections:

- Session persistence to `~/.n8n/whatsapp/sessions/<sessionId>/`
- Auto-reconnect with exponential backoff (max 10 attempts)
- QR code and pairing code generation
- Event fanning out via per-session `EventBus` instances

**EventBus** (`shared/EventBus.ts`): Each session has its own EventBus that fans out Baileys socket events to multiple trigger nodes without creating extra WhatsApp connections. Subscribe via `backend.subscribe(sessionId, eventName, subscriber)`.

**Bootstrap** (`shared/Bootstrap.ts`): Auto-runs on package import to restore persisted sessions across both backends.

### Nodes Structure

All nodes follow the same pattern:
1. Resolve backend via `resolveBackend(ctx, itemIndex)` or `resolveBackendForTrigger(ctx)`
2. Get socket via `backend.getOrThrowSocket(sessionId)`
3. Execute backend-specific operations (often via `assertCapability` checks)
4. Return n8n items

**Node Types**:
- **WhatsAppLogin**: Session management (connect, QR/pairing, status, disconnect, delete)
- **WhatsAppSend**: Send messages (text, media, polls, reactions, buttons, lists, etc.)
- **WhatsAppGroup**: Group operations (create, members, settings, invites)
- **WhatsAppProfile**: Profile operations (status, business profile, privacy settings)
- **WhatsAppQuery**: Query operations (contacts, chats, message history)
- **WhatsAppTrigger**: Trigger node for workflow automation on events
- **WhatsAppEvents**: Synchronous event-waiting node (poll up to N seconds for next event)
- **WhatsAppRaw**: Execute raw JavaScript against the socket (bypasses capability registry)

### Credential System

**WhatsAppSession** credential (`credentials/WhatsAppSession.credentials.ts`):
- Stores session ID and backend preference
- Optional phone number for pairing code auth
- Auto-reconnect setting
- No actual credentials stored — auth persists to filesystem via Baileys' `useMultiFileAuthState`

## Development Commands

```bash
# Build TypeScript and copy icons
npm run build

# Watch mode for development
npm run dev

# Lint TypeScript files
npm run lint

# Auto-fix lint issues
npm run lintfix

# Format with Prettier
npm run format

# Run tests
npm test
```

### Build Output

- `dist/` contains compiled JavaScript and type declarations
- Icons are copied from `nodes/**/*.svg` to `dist/nodes/` via gulp

## Testing

Tests use Jest with `ts-jest`. The `anya-bail` dependency is mocked in `test/SessionManager.test.ts` to avoid creating real WhatsApp connections.

```bash
# Run all tests
npx jest

# Run specific test file
npx jest test/SessionManager.test.ts
```

## Key Files to Understand

**Backend System**:
- `shared/backends/IWhatsAppBackend.ts` — Interface all nodes depend on
- `shared/backends/BackendResolver.ts` — Resolution logic and singleton caching
- `shared/backends/LegacyBackend.ts` — Legacy backend wrapper
- `shared/backends/OfficialBackend.ts` — Official backend wrapper
- `shared/backends/CapabilityRegistry.ts` — Feature flags and error messages

**Core Utilities**:
- `shared/SessionManager.ts` — Legacy session management
- `shared/EventBus.ts` — Event fanning-out system
- `shared/Utils.ts` — JID normalization, phone sanitization, media helpers
- `shared/MessageHelpers.ts` — Message building functions
- `shared/GroupHelpers.ts` — Group operations
- `shared/Types.ts` — Shared TypeScript types

**Node Examples**:
- `nodes/WhatsAppLogin/WhatsAppLogin.node.ts` — Session operations
- `nodes/WhatsAppSend/WhatsAppSend.node.ts` — Message sending
- `nodes/WhatsAppTrigger/WhatsAppTrigger.node.ts` — Event triggers

## Important Constraints

1. **Never import `anya-bail` or `baileys` directly in node code** — always use `BackendResolver` and `IWhatsAppBackend`
2. **Always use `assertCapability()` before backend-specific operations** to provide clear error messages
3. **Session IDs are sanitized** (alphanumeric, underscore, dash only) via `sanitiseSessionId()`
4. **Phone numbers for pairing must be sanitized** (digits only) via `normalisePhoneForPairing()` to avoid silent failures
5. **Pairing codes are requested once per QR rotation** — requesting again invalidates the previous code
6. **Both backends share socket event structure** due to common Baileys lineage, allowing backend-agnostic event handling

## Backend-Specific Features

**Legacy-only (anya-bail)**: `ai` message flag, `sendTable()`, `initiateCall()`
**Official-only**: None currently exposed (channels/newsletters exist but intentionally disabled)

Add operations to `BackendCapabilities` flags when introducing backend-specific features, and update `assertCapability()` calls in relevant nodes.
# n8n-nodes-whatsapp-baileys

A production-ready n8n community node package integrating WhatsApp via the
[`anya-bail`](https://www.npmjs.com/package/anya-bail) fork of Baileys
(`@queenanya/baileys`).

---

## Features

- **Multiple simultaneous sessions** — manage many WhatsApp accounts at once
- **QR and Pairing Code auth** — flexible authentication options
- **Persistent storage** — sessions survive n8n and server restarts
- **Auto-reconnect** — exponential backoff, up to 10 attempts
- **Singleton sockets** — one Baileys socket per session, shared across all nodes
- **Central EventBus** — multiple Trigger nodes subscribe without extra WA connections
- **Full anya-bail API** — interactive buttons, lists, albums, calls, AI icon, rich messages
- **Raw node** — write arbitrary JavaScript against any socket method

---

## Nodes Included

| Node | Purpose |
|---|---|
| **WhatsApp Login** | Connect, QR/pairing code, status, disconnect, delete |
| **WhatsApp Send** | Text, image, video, audio, voice, document, sticker, location, contact, poll, reaction, buttons, lists, forward, delete, edit, pin |
| **WhatsApp Group** | Create, join, leave, manage members, settings, invites |
| **WhatsApp Profile** | Status, picture, name, block/unblock, business profile, privacy |
| **WhatsApp Query** | Check existence, contacts, chats, groups, devices, blocklist, presence |
| **WhatsApp Trigger** | Event-driven: messages, media, edits, deletes, groups, calls, connection |
| **WhatsApp Events** | Wait for and capture the next event of a specific type |
| **WhatsApp Raw** | Execute raw JavaScript against the Baileys socket |

---

## Installation

### In n8n (recommended)

```bash
# From your n8n installation directory
npm install n8n-nodes-whatsapp-baileys
```

Or via the n8n GUI: **Settings → Community Nodes → Install** → enter `n8n-nodes-whatsapp-baileys`.

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

1. Add a **WhatsApp Login** node to your workflow.
2. Set **Operation** → `Connect / Get QR`.
3. Give your session a unique **Session ID** (e.g. `my-account`).
4. Execute the node — it returns a QR code as text and as a PNG binary.
5. Scan the QR with WhatsApp → **Settings → Linked Devices → Link a Device**.
6. Re-execute to confirm the session is connected.

### 2. Sending a Message

```
WhatsApp Login → WhatsApp Send
```

In **WhatsApp Send**:
- Session ID: `my-account`
- Operation: `Text`
- To: `+1234567890`
- Text: `Hello from n8n!`

### 3. Triggering on Incoming Messages

Add a **WhatsApp Trigger** node:
- Session ID: `my-account`
- Trigger Mode: `Incoming Message`

The workflow fires each time a message arrives.

### 4. Raw API Access

Use **WhatsApp Raw** to call any Baileys method:

```javascript
// Fetch all groups
const groups = await sock.groupFetchAllParticipating();
return Object.values(groups);
```

```javascript
// Send AI-icon message (anya-bail exclusive)
await sock.sendMessage('1234567890@s.whatsapp.net', { text: 'I am a bot!' }, { ai: true });
return { sent: true };
```

---

## Storage Layout

All data is stored under `~/.n8n/whatsapp/`:

```
~/.n8n/whatsapp/
├── sessions/
│   ├── default/           # Multi-file auth state for "default" session
│   │   ├── creds.json
│   │   └── *.json
│   └── my-account/
├── logs/
│   ├── system.log
│   └── my-account.log
├── cache/
│   └── qr/
│       └── my-account.png
└── metadata.json          # Session metadata index
```

Sessions persist across:
- n8n restarts
- Server reboots
- Workflow changes

No QR re-scanning is needed unless you explicitly delete a session or log out from WhatsApp.

---

## Credentials

Create a **WhatsApp Session** credential:

| Field | Description |
|---|---|
| Session ID | Unique identifier for this account |
| Authentication Method | QR Code or Pairing Code |
| Phone Number | Required for Pairing Code auth |
| Auto-Reconnect | Reconnect automatically on disconnect |

---

## anya-bail Exclusive Features

These features are available via **WhatsApp Raw** or dedicated operations:

```javascript
// AI icon on any message
await sock.sendMessage(jid, { text: 'Hello!' }, { ai: true });

// Rich table message
await sock.sendTable(jid, 'Title', ['Col1','Col2'], [['a','b']], null, {});

// Initiate a call
const { callId } = await sock.initiateCall(jid, { isVideo: false });

// Pairing code
const code = await sock.requestPairingCode('+1234567890');
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WA_DEBUG` | `0` | Set to `1` to enable verbose console logging |

---

## Development

```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm run lint       # ESLint
npm test           # Jest tests
```

---

## License

MIT — see [LICENSE](LICENSE).

> Based on [anya-bail](https://www.npmjs.com/package/anya-bail), itself forked from
> [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys).
> Not affiliated with WhatsApp or Meta.

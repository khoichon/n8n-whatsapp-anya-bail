# Pairing Code Authentication Fix

## Problem
Both QR code and pairing code authentication options were returning QR codes, regardless of credential settings.

## Root Cause
The issue was in the **session initialization timing**:

1. **Bootstrap runs on n8n boot** (before any node is executed)
2. **Bootstrap only has access to saved metadata** on disk, NOT the user's current credential settings
3. If a session was never created before, there's **no metadata** with `authMethod`/`pairingPhone`
4. **Bootstrap defaulted to QR** for new sessions, completely ignoring credential settings
5. WhatsAppLogin node **only polled existing state** - didn't create sessions or read credentials

## Solution

The fix required changes in **two places**:

### 1. Session Managers - Don't Save QR Code in Pairing Mode
**Files**:
- `shared/SessionManager.ts` (lines 270-306)
- `shared/backends/OfficialSessionManager.ts` (lines 283-320)

**Problem**: Session managers **always saved QR codes** when the `qr` event fired, regardless of authentication mode.

**Fix**: Only save QR code when NOT in pairing mode:

```typescript
if (qr) {
  // In pairing code mode, don't save QR code - only request pairing code
  if (!usePairingCode) {
    sessionState.qrCode = qr;
    logger.info('QR code generated');
  }

  // Request pairing code if in pairing mode
  if (usePairingCode && pairingPhone && !pairingCodeRequested) {
    const code = await sock.requestPairingCode(sanitisedPhone);
    sessionState.pairingCode = code;
    logger.info('Pairing code generated');
  }
}
```

### 2. WhatsAppLogin Node - Smart Polling by Auth Mode
**File**: `nodes/WhatsAppLogin/WhatsAppLogin.node.ts` (lines 137-248)

**Problem**: The node checked for QR code **first**, then pairing code. This meant if both existed (or if QR appeared first), it would return the QR code even in pairing mode.

**Fix**: 
1. Read `authMethod` from credentials **before** polling
2. Only poll for the code type matching `authMethod`
3. Use `authMethod` to determine result type (not the presence of codes)

```typescript
// Read auth method from credentials first
let authMethod: 'qr' | 'pairing' | undefined;
const credentials = await this.getCredentials('whatsAppSession', i);
authMethod = credentials?.authMethod;

// Poll only for the appropriate code type
while (Date.now() - startMs < waitMs) {
  const pollInfo = backend.getSessionInfo(sessionId);

  if (authMethod === 'pairing') {
    // Only look for pairing code
    if (pollInfo?.pairingCode) {
      code = pollInfo.pairingCode;
      break;
    }
  } else {
    // Only look for QR code
    if (pollInfo?.qrCode) {
      code = pollInfo.qrCode;
      break;
    }
  }

  await new Promise(r => setTimeout(r, 500));
}

// Use authMethod to determine result type
const isPairingCode = authMethod === 'pairing';
```

**Additional Fix**: Binary QR images are now only generated for QR mode:

```typescript
// Include QR image only if code exists AND image is requested AND we're in QR mode
if (code && includeImage && !isPairingCode) {
  // Generate QR bitmap...
}
```
**Files**: 
- `shared/SessionManager.ts` (lines 270-306)
- `shared/backends/OfficialSessionManager.ts` (lines 283-320)

**The Problem**: Both session managers **always saved the QR code** when the `qr` event fired, regardless of authentication mode. Then they requested a pairing code if in pairing mode. This meant pairing mode sessions had BOTH a QR code and a pairing code, and the node returned the QR code.

**The Fix**: Only save the QR code when NOT in pairing mode:

```typescript
if (qr) {
  // In pairing code mode, don't save QR code - only request pairing code
  if (!usePairingCode) {
    sessionState.qrCode = qr;
    try {
      sessionState.qrImagePath = await generateQRImage(qr, sessionId);
    } catch { /* non-critical */ }
    logger.info('QR code generated');
  }

  // Request pairing code if in pairing mode
  if (usePairingCode && pairingPhone && !pairingCodeRequested) {
    pairingCodeRequested = true;
    const sanitisedPhone = normalisePhoneForPairing(pairingPhone);
    const code = await sock.requestPairingCode(sanitisedPhone);
    sessionState.pairingCode = code;
    logger.info('Pairing code generated', { code });
  }
}
```

Now:
- **QR mode**: `sessionState.qrCode` is set, `sessionState.pairingCode` is not
- **Pairing mode**: `sessionState.pairingCode` is set, `sessionState.qrCode` is not

### 2. WhatsAppLogin Node Now Creates Sessions on Demand
**File**: `nodes/WhatsAppLogin/WhatsAppLogin.node.ts`

Changed the "Get Code / Status" operation to:
- Check if session exists
- If not, **read current credential settings** (authMethod, pairingPhone)
- **Create the session** with correct authentication method
- Poll for the generated code

```typescript
// Check if session exists, if not create it using current credential settings
const info = backend.getSessionInfo(sessionId);
if (!info) {
  // Read current credential settings to determine auth method
  const credentials = await this.getCredentials('whatsAppSession', i);
  const authMethod = credentials?.authMethod as 'qr' | 'pairing' | undefined;
  const pairingPhone = credentials?.pairingPhone as string | undefined;

  // Create session with current credential settings
  await backend.connect({
    sessionId,
    usePairingCode: authMethod === 'pairing',
    pairingPhone: pairingPhone,
  });
}
```

### 2. Bootstrap Now Skips Sessions Without Metadata
**Files**: 
- `shared/SessionManager.ts`
- `shared/backends/OfficialSessionManager.ts`

Changed `restoreAll()` to:
- Only auto-login sessions with **saved auth preferences** in metadata
- Skip sessions without metadata (they'll be created on-demand by the node)
- Removed fallback to QR for new sessions

**Before**:
```typescript
if (meta && (meta.authMethod === 'pairing' || meta.authMethod === 'qr')) {
  await this.create({ /* use saved preferences */ });
} else {
  // No auth preferences - just connect (defaults to QR)
  await this.create({ sessionId: id });
}
```

**After**:
```typescript
if (meta && (meta.authMethod === 'pairing' || meta.authMethod === 'qr')) {
  await this.create({ /* use saved preferences */ });
}
// If no auth preferences saved, skip auto-login
// The WhatsAppLogin node will create the session on-demand using current credential settings
```

## How It Works Now

### First-Time Setup
1. User creates credential with:
   - `authMethod: 'pairing'`
   - `pairingPhone: '+1234567890'`
2. User runs "Get Code / Status" node
3. Node detects session doesn't exist
4. Node reads credential settings
5. Node creates session with `usePairingCode: true, pairingPhone: '+1234567890'`
6. Session generates pairing code
7. Node returns pairing code to user

### Subsequent Runs
1. On n8n boot, bootstrap finds session with saved `authMethod: 'pairing'`
2. Bootstrap auto-connects with pairing code
3. When user runs node, pairing code is ready
4. After successful auth, session auto-reconnects with saved preferences

### Changing Auth Method
1. User updates credential (e.g., changes from 'pairing' to 'qr')
2. Old session metadata still has old `authMethod`
3. Node uses existing session (might show old auth method initially)
4. **Solution**: Delete session to clear metadata, then re-create with new auth method

## Benefits

✅ **Credential Settings Drive Behavior**: Current credential settings are now respected  
✅ **On-Demand Creation**: Sessions are created when needed, not blindly on boot  
✅ **Consistent Behavior**: Both first-time and subsequent runs work correctly  
✅ **No Silent Defaults**: Doesn't silently fall back to QR when pairing is configured  

## Testing

### Test Pairing Code Authentication
1. Create credential with:
   - Backend: Legacy or Official
   - Session ID: test-pairing
   - Auth Method: Pairing Code
   - Phone Number: +1234567890
2. Run "Get Code / Status" operation
3. Should return `pairingCode` (not `qrCode`)
4. Verify in output: `authMethod: 'pairing'`

### Test QR Code Authentication
1. Create credential with:
   - Backend: Legacy or Official
   - Session ID: test-qr
   - Auth Method: QR Code
2. Run "Get Code / Status" operation
3. Should return `qrCode` (not `pairingCode`)
4. Verify in output: `authMethod: 'qr'`

### Test Auto-Reconnect After Auth
1. Complete authentication with either method
2. Restart n8n
3. Run "Get Detailed Status" operation
4. Should show `connected: true` with correct phone number

## Files Modified

- ✅ `nodes/WhatsAppLogin/WhatsAppLogin.node.ts` - Added on-demand session creation with credential settings
- ✅ `shared/SessionManager.ts` - Changed `restoreAll()` to skip sessions without metadata
- ✅ `shared/backends/OfficialSessionManager.ts` - Same `restoreAll()` changes as above

## Architecture Changes

**Before**:
```
Bootstrap (no credential access)
  ↓
Create sessions with default QR (blind fallback)
  ↓
WhatsAppLogin node just polls existing state
```

**After**:
```
Bootstrap (no credential access)
  ↓
Only restore sessions with saved metadata
  ↓
WhatsAppLogin node creates sessions on-demand using current credentials
```

This ensures **current credential settings always drive behavior**, not silent defaults or outdated metadata.

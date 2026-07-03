import type { BackendCapabilities, BackendId } from './Types';

/**
 * Legacy backend (anya-bail / @queenanya/baileys).
 * This fork adds a small number of exclusive extras (AI icon, rich table
 * messages, `initiateCall`) on top of a WhiskeySockets/Baileys base.
 */
export const LEGACY_CAPABILITIES: BackendCapabilities = {
  messages: true,
  media: true,
  polls: true,
  reactions: true,
  presence: true,
  channels: false,
  newsletters: false,
  editing: true,
  status: true,
  buttons: true,
  lists: true,
  groupManagement: true,
  qrLogin: true,
  pairingCode: true,
  calls: true,
  businessProfile: true,
  privacySettings: true,
  blocklist: true,
  aiIcon: true,
  tableMessages: true,
  rawSocketAccess: true,
};

/**
 * Official Baileys (`baileys` on npm, WhiskeySockets/Baileys).
 * Newsletter/channel administration is present in recent official
 * releases but is intentionally kept off until it has been verified
 * against this package's node surface — see README migration guide.
 */
export const OFFICIAL_CAPABILITIES: BackendCapabilities = {
  messages: true,
  media: true,
  polls: true,
  reactions: true,
  presence: true,
  channels: false,
  newsletters: false,
  editing: true,
  status: true,
  buttons: true,
  lists: true,
  groupManagement: true,
  qrLogin: true,
  pairingCode: true,
  calls: false,
  businessProfile: true,
  privacySettings: true,
  blocklist: true,
  aiIcon: false,
  tableMessages: false,
  rawSocketAccess: true,
};

export const CAPABILITIES_BY_BACKEND: Record<BackendId, BackendCapabilities> = {
  legacy: LEGACY_CAPABILITIES,
  official: OFFICIAL_CAPABILITIES,
};

export const BACKEND_DISPLAY_NAME: Record<BackendId, string> = {
  legacy: 'Legacy (anya-bail)',
  official: 'Official Baileys',
};

export function getCapabilities(backend: BackendId): BackendCapabilities {
  return CAPABILITIES_BY_BACKEND[backend];
}

/**
 * Human-readable descriptions used in unsupported-operation errors.
 * Keep in sync with `BackendCapabilities` keys.
 */
const FEATURE_LABELS: Record<keyof BackendCapabilities, string> = {
  messages: 'Messaging',
  media: 'Media Messages',
  polls: 'Polls',
  reactions: 'Reactions',
  presence: 'Presence Updates',
  channels: 'Channel Administration',
  newsletters: 'Newsletter Administration',
  editing: 'Message Editing',
  status: 'Status / About Text',
  buttons: 'Interactive Buttons',
  lists: 'List Messages',
  groupManagement: 'Group Management',
  qrLogin: 'QR Code Login',
  pairingCode: 'Pairing Code Login',
  calls: 'Voice/Video Calls',
  businessProfile: 'Business Profile',
  privacySettings: 'Privacy Settings',
  blocklist: 'Blocklist',
  aiIcon: 'AI Icon Badge (anya-bail exclusive)',
  tableMessages: 'Rich Table Messages (anya-bail exclusive)',
  rawSocketAccess: 'Raw Socket Access',
};

export interface UnsupportedFeatureInfo {
  message: string;
  description: string;
}

/**
 * Builds the descriptive error content nodes should surface via
 * NodeOperationError when a requested feature is not in the active
 * backend's capability set. Nodes are responsible for actually throwing
 * (they need `this.getNode()` / `itemIndex`, which live outside this file).
 */
export function buildUnsupportedFeatureError(
  backend: BackendId,
  feature: keyof BackendCapabilities,
  suggestBackend?: BackendId,
): UnsupportedFeatureInfo {
  const featureLabel = FEATURE_LABELS[feature];
  const suggestion = suggestBackend
    ? `Switch Backend to "${BACKEND_DISPLAY_NAME[suggestBackend]}".`
    : 'No other configured backend currently supports this feature.';

  return {
    message: `Operation not supported on backend "${BACKEND_DISPLAY_NAME[backend]}": ${featureLabel}`,
    description:
      `Backend: ${BACKEND_DISPLAY_NAME[backend]}\n` +
      `Feature: ${featureLabel}\n\n` +
      `Suggestion: ${suggestion}`,
  };
}

/** Finds another configured backend (if any) that supports the given feature. */
export function findBackendSupporting(feature: keyof BackendCapabilities, exclude: BackendId): BackendId | undefined {
  return (Object.keys(CAPABILITIES_BY_BACKEND) as BackendId[]).find(
    id => id !== exclude && CAPABILITIES_BY_BACKEND[id][feature],
  );
}

import type { IExecuteFunctions, ITriggerFunctions, IDataObject } from 'n8n-workflow';
import { LegacyBackend } from './LegacyBackend';
import { OfficialBackend } from './OfficialBackend';
import type { IWhatsAppBackend } from './IWhatsAppBackend';
import type { BackendId, BackendSelection } from './Types';
import { sanitiseSessionId } from '../Utils';

/**
 * BackendResolver
 * ───────────────
 * Every node calls this instead of touching `SessionManager` /
 * `OfficialSessionManager` / a credential field directly.
 *
 * Resolution order (first match wins):
 *   1. Node's own "Backend Override" parameter, if not "Use Credential Setting"
 *   2. The credential's "Backend" field
 *   3. Default: "legacy" (preserves pre-upgrade behaviour for anyone who
 *      hasn't touched either setting)
 *
 * The resolver also owns backend singleton caching/reuse (both
 * LegacyBackend and OfficialBackend are themselves singletons wrapping
 * their respective session managers, so "reuse connections where
 * appropriate" falls out naturally: the same session ID + backend
 * combination always maps to the same live socket).
 *
 * NOTE: `IExecuteFunctions.getNodeParameter(name, itemIndex, fallback?)`
 * and `ITriggerFunctions.getNodeParameter(name, fallback?, options?)` have
 * genuinely different signatures (Trigger nodes have no item list), so
 * this file exposes two entry points rather than papering over that
 * difference with unsafe casts.
 */
export function getBackendInstance(id: BackendId): IWhatsAppBackend {
  return id === 'official' ? OfficialBackend.getInstance() : LegacyBackend.getInstance();
}

export interface ResolvedBackend {
  backendId: BackendId;
  backend: IWhatsAppBackend;
  sessionId: string;
  authMethod: 'qr' | 'pairing';
  pairingPhone?: string;
}

async function readCredentialBackend(
  getCredentials: (name: string) => Promise<IDataObject | undefined>,
): Promise<{ backend: BackendId; sessionId?: string; authMethod?: 'qr' | 'pairing'; pairingPhone?: string }> {
  try {
    const creds = await getCredentials('whatsAppSession');
    if (creds) {
      return {
        backend: creds.backend === 'official' ? 'official' : 'legacy',
        sessionId: typeof creds.sessionId === 'string' && creds.sessionId ? creds.sessionId : undefined,
        authMethod: creds.authMethod === 'pairing' ? 'pairing' : 'qr',
        pairingPhone: typeof creds.pairingPhone === 'string' ? creds.pairingPhone : undefined,
      };
    }
  } catch {
    // Credential not attached/required on this node — fall back to defaults.
  }
  return { backend: 'legacy', authMethod: 'qr', pairingPhone: undefined };
}

/** For IExecuteFunctions-based nodes (Send, Group, Profile, Query, Login). */
export async function resolveBackend(ctx: IExecuteFunctions, itemIndex: number): Promise<ResolvedBackend> {
  const { backend: credentialBackend, sessionId: credSessionId, authMethod, pairingPhone } = await readCredentialBackend(
    name => ctx.getCredentials(name) as Promise<IDataObject | undefined>,
  );

  let override: BackendSelection = 'useCredential';
  try {
    override = (ctx.getNodeParameter('backendOverride', itemIndex, 'useCredential') as BackendSelection) ?? 'useCredential';
  } catch {
    /* node predates the override param — behave as if unset */
  }

  const backendId: BackendId = override === 'useCredential' ? credentialBackend : override;

  let rawSessionId = credSessionId ?? 'default';
  try {
    const nodeSessionId = ctx.getNodeParameter('sessionId', itemIndex, undefined) as string | undefined;
    if (nodeSessionId) rawSessionId = nodeSessionId;
  } catch {
    /* some nodes don't expose sessionId per-item */
  }

  const sessionId = sanitiseSessionId(rawSessionId);
  return { backendId, backend: getBackendInstance(backendId), sessionId, authMethod: authMethod ?? 'qr', pairingPhone };
}

/** For ITriggerFunctions-based nodes (Trigger, Events). */
export async function resolveBackendForTrigger(ctx: ITriggerFunctions): Promise<ResolvedBackend> {
  const { backend: credentialBackend, sessionId: credSessionId, authMethod, pairingPhone } = await readCredentialBackend(
    name => ctx.getCredentials(name) as Promise<IDataObject | undefined>,
  );

  let override: BackendSelection = 'useCredential';
  try {
    override = (ctx.getNodeParameter('backendOverride', 'useCredential') as BackendSelection) ?? 'useCredential';
  } catch {
    /* node predates the override param — behave as if unset */
  }

  const backendId: BackendId = override === 'useCredential' ? credentialBackend : override;

  let rawSessionId = credSessionId ?? 'default';
  try {
    const nodeSessionId = ctx.getNodeParameter('sessionId', undefined) as string | undefined;
    if (nodeSessionId) rawSessionId = nodeSessionId;
  } catch {
    /* ignore */
  }

  const sessionId = sanitiseSessionId(rawSessionId);
  return { backendId, backend: getBackendInstance(backendId), sessionId, authMethod: authMethod ?? 'qr', pairingPhone };
}

/** Shared "Backend Override" node property — add to every node's properties array. */
export const BACKEND_OVERRIDE_PROPERTY = {
  displayName: 'Backend Override',
  name: 'backendOverride',
  type: 'options' as const,
  options: [
    { name: 'Use Credential Setting', value: 'useCredential' },
    { name: 'Legacy (anya-bail)', value: 'legacy' },
    { name: 'Official Baileys', value: 'official' },
  ],
  default: 'useCredential',
  description:
    'Which WhatsApp backend SDK to use for this node. Advanced: intended for testing and gradual migration. Most users should leave this on "Use Credential Setting".',
};

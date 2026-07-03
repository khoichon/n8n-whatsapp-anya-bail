/**
 * `WAClientSocket` is a *structural* interface covering exactly the socket
 * methods this package calls. Both `anya-bail` (legacy) and `baileys`
 * (official) share the same upstream lineage (WhiskeySockets/Baileys), so
 * the real socket objects returned by `makeWASocket()` in either package
 * satisfy this interface without any adapter/wrapper object being needed.
 *
 * This is what allows `shared/GroupHelpers.ts`, `shared/ProfileHelpers.ts`
 * and `shared/MessageHelpers.ts` (all pre-existing, unmodified files) to
 * keep working unchanged regardless of which backend produced the socket —
 * they only need to depend on this interface instead of the concrete
 * `anya-bail` SDK type.
 *
 * Anything backend-exclusive (anya-bail's `ai` flag, `sendTable`,
 * `initiateCall`, etc.) is intentionally left out of this interface and is
 * instead accessed through the Capability Registry + WhatsApp Raw node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface WAClientSocket {
  user?: { id: string; name?: string } | null;
  ev: {
    on: (event: string, listener: (...args: any[]) => void) => unknown;
    off?: (event: string, listener: (...args: any[]) => void) => unknown;
    removeAllListeners?: (event?: string) => unknown;
  };
  logout: (msg?: string) => Promise<void>;
  end: (error: Error | undefined) => void;
  requestPairingCode: (phoneNumber: string, customCode?: string) => Promise<string>;

  sendMessage: (jid: string, content: unknown, options?: unknown) => Promise<any>;
  onWhatsApp: (...jids: string[]) => Promise<Array<{ exists: boolean; jid: string }>>;
  sendPresenceUpdate: (type: string, toJid?: string) => Promise<void>;
  getUSyncDevices?: (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => Promise<unknown>;
  fetchBlocklist: () => Promise<string[]>;
  fetchStatus: (jid: string) => Promise<any>;
  fetchPrivacySettings: (force?: boolean) => Promise<any>;

  // Groups
  groupMetadata: (jid: string) => Promise<any>;
  groupCreate: (subject: string, participants: string[]) => Promise<any>;
  groupParticipantsUpdate: (jid: string, participants: string[], action: 'add' | 'remove' | 'promote' | 'demote') => Promise<any>;
  groupInviteCode: (jid: string) => Promise<string | undefined>;
  groupRevokeInvite: (jid: string) => Promise<string | undefined>;
  groupAcceptInvite: (code: string) => Promise<string | undefined>;
  groupLeave: (jid: string) => Promise<void>;
  groupUpdateSubject: (jid: string, subject: string) => Promise<void>;
  groupUpdateDescription: (jid: string, description?: string) => Promise<void>;
  groupSettingUpdate: (jid: string, setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked') => Promise<void>;
  groupFetchAllParticipating: () => Promise<Record<string, any>>;

  // Profile
  profilePictureUrl: (jid: string, type?: 'preview' | 'image') => Promise<string | undefined>;
  updateProfilePicture: (jid: string, content: Buffer | { url: string }) => Promise<void>;
  updateProfileStatus: (status: string) => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
  updateBlockStatus: (jid: string, action: 'block' | 'unblock') => Promise<void>;
  getBusinessProfile: (jid: string) => Promise<any>;

  [extra: string]: any;
}

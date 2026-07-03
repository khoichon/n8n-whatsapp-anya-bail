import type { WAClientSocket as WASocket } from './backends/SocketInterface';
import { normaliseJid } from './Utils';

export async function getStatus(sock: WASocket, jid: string) {
  return sock.fetchStatus(jid);
}

export async function setStatus(sock: WASocket, status: string) {
  return sock.updateProfileStatus(status);
}

export async function getProfilePicture(sock: WASocket, jid: string): Promise<string | undefined> {
  try {
    return await sock.profilePictureUrl(jid, 'image');
  } catch {
    return undefined;
  }
}

export async function setProfilePicture(sock: WASocket, imageBuffer: Buffer) {
  return sock.updateProfilePicture(sock.user!.id, imageBuffer);
}

export async function setProfileName(sock: WASocket, name: string) {
  return sock.updateProfileName(name);
}

export async function blockUser(sock: WASocket, jid: string) {
  return sock.updateBlockStatus(normaliseJid(jid), 'block');
}

export async function unblockUser(sock: WASocket, jid: string) {
  return sock.updateBlockStatus(normaliseJid(jid), 'unblock');
}

export async function getBusinessProfile(sock: WASocket, jid: string) {
  return sock.getBusinessProfile(normaliseJid(jid));
}

export async function fetchPrivacySettings(sock: WASocket) {
  return sock.fetchPrivacySettings(true);
}

export async function updatePrivacySettings(
  sock: WASocket,
  settings: Record<string, string>,
): Promise<{ updated: Record<string, string> }> {
  // updatePrivacySettings is not typed on WASocket in this version of anya-bail;
  // cast to any to call it directly.
  const s = sock as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  if (typeof s['updatePrivacySettings'] === 'function') {
    const updates: Array<Promise<unknown>> = [];
    for (const [type, value] of Object.entries(settings)) {
      updates.push(s['updatePrivacySettings'](type, value));
    }
    await Promise.all(updates);
  }
  return { updated: settings };
}

import type { WAClientSocket as WASocket } from './backends/SocketInterface';
import { normaliseJid } from './Utils';

export async function getGroupMetadata(sock: WASocket, groupJid: string) {
  return sock.groupMetadata(groupJid);
}

export async function createGroup(
  sock: WASocket,
  subject: string,
  participants: string[],
) {
  const jids = participants.map(normaliseJid);
  return sock.groupCreate(subject, jids);
}

export async function addGroupParticipants(
  sock: WASocket,
  groupJid: string,
  participants: string[],
) {
  const jids = participants.map(normaliseJid);
  return sock.groupParticipantsUpdate(groupJid, jids, 'add');
}

export async function removeGroupParticipants(
  sock: WASocket,
  groupJid: string,
  participants: string[],
) {
  const jids = participants.map(normaliseJid);
  return sock.groupParticipantsUpdate(groupJid, jids, 'remove');
}

export async function promoteGroupParticipants(
  sock: WASocket,
  groupJid: string,
  participants: string[],
) {
  const jids = participants.map(normaliseJid);
  return sock.groupParticipantsUpdate(groupJid, jids, 'promote');
}

export async function demoteGroupParticipants(
  sock: WASocket,
  groupJid: string,
  participants: string[],
) {
  const jids = participants.map(normaliseJid);
  return sock.groupParticipantsUpdate(groupJid, jids, 'demote');
}

export async function getGroupInviteCode(sock: WASocket, groupJid: string): Promise<string | undefined> {
  return sock.groupInviteCode(groupJid);
}

export async function revokeGroupInviteCode(sock: WASocket, groupJid: string): Promise<string | undefined> {
  return sock.groupRevokeInvite(groupJid);
}

export async function joinGroupViaInvite(sock: WASocket, inviteCode: string) {
  return sock.groupAcceptInvite(inviteCode);
}

export async function leaveGroup(sock: WASocket, groupJid: string) {
  return sock.groupLeave(groupJid);
}

export async function setGroupSubject(sock: WASocket, groupJid: string, subject: string) {
  return sock.groupUpdateSubject(groupJid, subject);
}

export async function setGroupDescription(sock: WASocket, groupJid: string, description: string) {
  return sock.groupUpdateDescription(groupJid, description);
}

export async function setGroupAnnounce(sock: WASocket, groupJid: string, announce: boolean) {
  return sock.groupSettingUpdate(groupJid, announce ? 'announcement' : 'not_announcement');
}

export async function setGroupRestrict(sock: WASocket, groupJid: string, restrict: boolean) {
  return sock.groupSettingUpdate(groupJid, restrict ? 'locked' : 'unlocked');
}

export async function getAllGroups(sock: WASocket) {
  return sock.groupFetchAllParticipating();
}

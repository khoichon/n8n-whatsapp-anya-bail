import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { SessionManager } from '../../shared/SessionManager';
import * as GroupHelpers from '../../shared/GroupHelpers';
import { normaliseGroupJid, sanitiseSessionId } from '../../shared/Utils';

export class WhatsAppGroup implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Group',
    name: 'whatsAppGroup',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Manage WhatsApp groups: create, modify members, settings, and invites',
    defaults: { name: 'WhatsApp Group' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'whatsAppSession', required: true }],
    properties: [
      {
        displayName: 'Session ID',
        name: 'sessionId',
        type: 'string',
        default: 'default',
        required: true,
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Create Group', value: 'create' },
          { name: 'Get All Groups', value: 'getAll' },
          { name: 'Get Metadata', value: 'getMetadata' },
          { name: 'Get Invite Code', value: 'getInviteCode' },
          { name: 'Revoke Invite Code', value: 'revokeInvite' },
          { name: 'Join via Invite Code', value: 'joinViaInvite' },
          { name: 'Leave Group', value: 'leave' },
          { name: 'Add Members', value: 'addMembers' },
          { name: 'Remove Members', value: 'removeMembers' },
          { name: 'Promote Members', value: 'promote' },
          { name: 'Demote Members', value: 'demote' },
          { name: 'Set Subject (Name)', value: 'setSubject' },
          { name: 'Set Description', value: 'setDescription' },
          { name: 'Lock Group (Admins Only)', value: 'lock' },
          { name: 'Unlock Group', value: 'unlock' },
          { name: 'Announce Mode On', value: 'announce' },
          { name: 'Announce Mode Off', value: 'unannounce' },
        ],
        default: 'getMetadata',
      },

      // Group JID
      {
        displayName: 'Group JID',
        name: 'groupJid',
        type: 'string',
        default: '',
        placeholder: '1234567890-1234567890@g.us',
        required: true,
        displayOptions: {
          show: {
            operation: [
              'getMetadata', 'getInviteCode', 'revokeInvite', 'leave',
              'addMembers', 'removeMembers', 'promote', 'demote',
              'setSubject', 'setDescription', 'lock', 'unlock',
              'announce', 'unannounce',
            ],
          },
        },
      },

      // Create group
      {
        displayName: 'Group Name',
        name: 'groupName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['create'] } },
      },
      {
        displayName: 'Initial Participants',
        name: 'initialParticipants',
        type: 'string',
        default: '',
        placeholder: '+1234567890, +0987654321',
        description: 'Comma-separated phone numbers to add on creation',
        displayOptions: { show: { operation: ['create'] } },
      },

      // Participants for add/remove/promote/demote
      {
        displayName: 'Participants',
        name: 'participants',
        type: 'string',
        default: '',
        placeholder: '+1234567890, +0987654321',
        description: 'Comma-separated phone numbers',
        displayOptions: {
          show: { operation: ['addMembers', 'removeMembers', 'promote', 'demote'] },
        },
      },

      // Subject
      {
        displayName: 'New Subject',
        name: 'subject',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['setSubject'] } },
      },

      // Description
      {
        displayName: 'New Description',
        name: 'description',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        displayOptions: { show: { operation: ['setDescription'] } },
      },

      // Invite code
      {
        displayName: 'Invite Code',
        name: 'inviteCode',
        type: 'string',
        default: '',
        description: 'The invite code (not the full URL)',
        displayOptions: { show: { operation: ['joinViaInvite'] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const manager = SessionManager.getInstance();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;
      const sessionId = sanitiseSessionId(this.getNodeParameter('sessionId', i) as string);

      try {
        const sock = manager.getOrThrow(sessionId);

        if (operation === 'getAll') {
          const groups = await GroupHelpers.getAllGroups(sock);
          const list = Object.values(groups);
          returnData.push({ json: { groups: list, count: list.length } });
          continue;
        }

        if (operation === 'create') {
          const name = this.getNodeParameter('groupName', i) as string;
          const participantsStr = this.getNodeParameter('initialParticipants', i, '') as string;
          const participants = participantsStr
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
          const result = await GroupHelpers.createGroup(sock, name, participants);
          returnData.push({ json: { success: true, group: result } });
          continue;
        }

        if (operation === 'joinViaInvite') {
          const code = this.getNodeParameter('inviteCode', i) as string;
          const gid = await GroupHelpers.joinGroupViaInvite(sock, code);
          returnData.push({ json: { success: true, groupId: gid } });
          continue;
        }

        const rawGroupJid = this.getNodeParameter('groupJid', i) as string;
        const groupJid = normaliseGroupJid(rawGroupJid);

        const parseParticipants = (): string[] => {
          const str = this.getNodeParameter('participants', i, '') as string;
          return str.split(',').map(s => s.trim()).filter(Boolean);
        };

        let result: unknown;

        switch (operation) {
          case 'getMetadata':
            result = await GroupHelpers.getGroupMetadata(sock, groupJid);
            break;
          case 'getInviteCode':
            result = { inviteCode: await GroupHelpers.getGroupInviteCode(sock, groupJid) };
            break;
          case 'revokeInvite':
            result = { newInviteCode: await GroupHelpers.revokeGroupInviteCode(sock, groupJid) };
            break;
          case 'leave':
            await GroupHelpers.leaveGroup(sock, groupJid);
            result = { success: true };
            break;
          case 'addMembers':
            result = await GroupHelpers.addGroupParticipants(sock, groupJid, parseParticipants());
            break;
          case 'removeMembers':
            result = await GroupHelpers.removeGroupParticipants(sock, groupJid, parseParticipants());
            break;
          case 'promote':
            result = await GroupHelpers.promoteGroupParticipants(sock, groupJid, parseParticipants());
            break;
          case 'demote':
            result = await GroupHelpers.demoteGroupParticipants(sock, groupJid, parseParticipants());
            break;
          case 'setSubject':
            await GroupHelpers.setGroupSubject(sock, groupJid, this.getNodeParameter('subject', i) as string);
            result = { success: true };
            break;
          case 'setDescription':
            await GroupHelpers.setGroupDescription(sock, groupJid, this.getNodeParameter('description', i) as string);
            result = { success: true };
            break;
          case 'lock':
            await GroupHelpers.setGroupRestrict(sock, groupJid, true);
            result = { success: true };
            break;
          case 'unlock':
            await GroupHelpers.setGroupRestrict(sock, groupJid, false);
            result = { success: true };
            break;
          case 'announce':
            await GroupHelpers.setGroupAnnounce(sock, groupJid, true);
            result = { success: true };
            break;
          case 'unannounce':
            await GroupHelpers.setGroupAnnounce(sock, groupJid, false);
            result = { success: true };
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        returnData.push({ json: { operation, groupJid, ...(result as object) } });
      } catch (err) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (err as Error).message }, pairedItem: i });
        } else {
          throw new NodeOperationError(this.getNode(), err as Error, { itemIndex: i });
        }
      }
    }

    return [returnData];
  }
}

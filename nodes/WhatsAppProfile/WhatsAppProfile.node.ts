import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { SessionManager } from '../../shared/SessionManager';
import * as ProfileHelpers from '../../shared/ProfileHelpers';
import { normaliseJid, sanitiseSessionId } from '../../shared/Utils';

export class WhatsAppProfile implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Profile',
    name: 'whatsAppProfile',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Manage WhatsApp profile: status, picture, privacy, and contact blocking',
    defaults: { name: 'WhatsApp Profile' },
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
          { name: 'Get My Status', value: 'getMyStatus' },
          { name: 'Get User Status', value: 'getUserStatus' },
          { name: 'Set Status', value: 'setStatus' },
          { name: 'Get Profile Picture', value: 'getPicture' },
          { name: 'Set Profile Picture', value: 'setPicture' },
          { name: 'Set Display Name', value: 'setName' },
          { name: 'Block User', value: 'block' },
          { name: 'Unblock User', value: 'unblock' },
          { name: 'Get Business Profile', value: 'getBusiness' },
          { name: 'Get Privacy Settings', value: 'getPrivacy' },
          { name: 'Set Privacy Settings', value: 'setPrivacy' },
        ],
        default: 'getMyStatus',
      },

      // Target JID
      {
        displayName: 'Phone / JID',
        name: 'targetJid',
        type: 'string',
        default: '',
        placeholder: '+1234567890',
        displayOptions: {
          show: { operation: ['getUserStatus', 'getPicture', 'block', 'unblock', 'getBusiness'] },
        },
      },

      // Status text
      {
        displayName: 'Status Text',
        name: 'statusText',
        type: 'string',
        default: '',
        placeholder: 'Hey there! I am using WhatsApp.',
        displayOptions: { show: { operation: ['setStatus'] } },
      },

      // Profile picture
      {
        displayName: 'Image Binary Property',
        name: 'imageBinaryProp',
        type: 'string',
        default: 'data',
        description: 'Name of the binary property containing the image',
        displayOptions: { show: { operation: ['setPicture'] } },
      },

      // Display name
      {
        displayName: 'Display Name',
        name: 'displayName',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['setName'] } },
      },

      // Privacy settings
      {
        displayName: 'Privacy Settings (JSON)',
        name: 'privacyJson',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '{"readreceipts":"all","profile":"contacts","status":"contacts","online":"all","last":"contacts","groupadd":"contacts"}',
        description: 'JSON object with privacy setting keys and values (all, contacts, contact_blacklist, none)',
        displayOptions: { show: { operation: ['setPrivacy'] } },
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
        let result: unknown;

        switch (operation) {
          case 'getMyStatus': {
            const myJid = sock.user?.id ?? '';
            result = await ProfileHelpers.getStatus(sock, myJid);
            break;
          }
          case 'getUserStatus': {
            const jid = normaliseJid(this.getNodeParameter('targetJid', i) as string);
            result = await ProfileHelpers.getStatus(sock, jid);
            break;
          }
          case 'setStatus': {
            const status = this.getNodeParameter('statusText', i) as string;
            await ProfileHelpers.setStatus(sock, status);
            result = { success: true, status };
            break;
          }
          case 'getPicture': {
            const jid = normaliseJid(this.getNodeParameter('targetJid', i) as string);
            const url = await ProfileHelpers.getProfilePicture(sock, jid);
            result = { jid, pictureUrl: url ?? null };
            break;
          }
          case 'setPicture': {
            const prop = this.getNodeParameter('imageBinaryProp', i, 'data') as string;
            const buf = await this.helpers.getBinaryDataBuffer(i, prop);
            await ProfileHelpers.setProfilePicture(sock, buf);
            result = { success: true };
            break;
          }
          case 'setName': {
            const name = this.getNodeParameter('displayName', i) as string;
            await ProfileHelpers.setProfileName(sock, name);
            result = { success: true, name };
            break;
          }
          case 'block': {
            const jid = normaliseJid(this.getNodeParameter('targetJid', i) as string);
            await ProfileHelpers.blockUser(sock, jid);
            result = { success: true, blocked: jid };
            break;
          }
          case 'unblock': {
            const jid = normaliseJid(this.getNodeParameter('targetJid', i) as string);
            await ProfileHelpers.unblockUser(sock, jid);
            result = { success: true, unblocked: jid };
            break;
          }
          case 'getBusiness': {
            const jid = normaliseJid(this.getNodeParameter('targetJid', i) as string);
            result = await ProfileHelpers.getBusinessProfile(sock, jid);
            break;
          }
          case 'getPrivacy': {
            result = await ProfileHelpers.fetchPrivacySettings(sock);
            break;
          }
          case 'setPrivacy': {
            const settings = JSON.parse(this.getNodeParameter('privacyJson', i) as string);
            result = await ProfileHelpers.updatePrivacySettings(sock, settings);
            break;
          }
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        returnData.push({ json: { operation, ...(result as object) } });
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

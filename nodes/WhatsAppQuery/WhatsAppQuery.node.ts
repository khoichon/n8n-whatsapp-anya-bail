import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { normaliseJid } from '../../shared/Utils';
import { resolveBackend, BACKEND_OVERRIDE_PROPERTY } from '../../shared/backends/BackendResolver';
import { assertCapability } from '../../shared/backends/assertCapability';

export class WhatsAppQuery implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Query',
    name: 'whatsAppQuery',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Query WhatsApp data: contacts, chats, groups, and more',
    defaults: { name: 'WhatsApp Query' },
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
      BACKEND_OVERRIDE_PROPERTY,
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Check Number Exists on WhatsApp', value: 'checkExists' },
          { name: 'Get Contact', value: 'getContact' },
          { name: 'Get All Contacts', value: 'getContacts' },
          { name: 'Get All Chats', value: 'getChats' },
          { name: 'Get All Groups', value: 'getGroups' },
          { name: 'Get Privacy Settings', value: 'getPrivacy' },
          { name: 'Get Linked Devices', value: 'getDevices' },
          { name: 'Get Blocklist', value: 'getBlocklist' },
          { name: 'Send Presence Update', value: 'sendPresence' },
        ],
        default: 'checkExists',
      },

      {
        displayName: 'Phone Number / JID',
        name: 'phoneOrJid',
        type: 'string',
        default: '',
        placeholder: '+1234567890',
        displayOptions: {
          show: { operation: ['checkExists', 'getContact'] },
        },
      },

      {
        displayName: 'Presence Type',
        name: 'presenceType',
        type: 'options',
        options: [
          { name: 'Available', value: 'available' },
          { name: 'Unavailable', value: 'unavailable' },
          { name: 'Composing (Typing)', value: 'composing' },
          { name: 'Recording', value: 'recording' },
          { name: 'Paused', value: 'paused' },
        ],
        default: 'available',
        displayOptions: { show: { operation: ['sendPresence'] } },
      },
      {
        displayName: 'Chat JID (for Composing/Recording)',
        name: 'presenceChatJid',
        type: 'string',
        default: '',
        description: 'The JID of the chat to send presence to. Leave empty for general presence.',
        displayOptions: { show: { operation: ['sendPresence'] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;

      try {
        const { backendId, backend, sessionId } = await resolveBackend(this, i);
        const caps = backend.capabilities;
        if (operation === 'getPrivacy') assertCapability(this, backendId, caps, 'privacySettings', i);
        if (operation === 'getBlocklist') assertCapability(this, backendId, caps, 'blocklist', i);
        if (operation === 'sendPresence') assertCapability(this, backendId, caps, 'presence', i);

        const sock = backend.getOrThrowSocket(sessionId);
        let result: unknown;

        switch (operation) {
          case 'checkExists': {
            const raw = this.getNodeParameter('phoneOrJid', i) as string;
            const jid = normaliseJid(raw);
            const [res] = await sock.onWhatsApp(jid);
            result = {
              jid,
              exists: res?.exists ?? false,
              jidOnWhatsApp: res?.jid ?? null,
            };
            break;
          }

          case 'getContact': {
            const raw = this.getNodeParameter('phoneOrJid', i) as string;
            const jid = normaliseJid(raw);
            try {
              const statusResults = await sock.fetchStatus(jid);
              const first = Array.isArray(statusResults) ? statusResults[0] : statusResults;
              result = { id: jid, statusResult: first ?? null };
            } catch {
              result = { id: jid, found: false };
            }
            break;
          }

          case 'getContacts': {
            result = { contacts: [], note: 'Use a store plugin or WhatsApp Trigger contacts.update event to cache contacts.' };
            break;
          }

          case 'getChats': {
            result = { chats: [], note: 'Use a store plugin or WhatsApp Trigger chats.update event to cache chats.' };
            break;
          }

          case 'getGroups': {
            const groups = await sock.groupFetchAllParticipating();
            const list = Object.values(groups);
            result = { groups: list, count: list.length };
            break;
          }

          case 'getPrivacy': {
            result = await sock.fetchPrivacySettings(true);
            break;
          }

          case 'getDevices': {
            const myJid = sock.user?.id ?? '';
            result = await sock.getUSyncDevices?.([myJid], false, false);
            break;
          }

          case 'getBlocklist': {
            result = await sock.fetchBlocklist();
            break;
          }

          case 'sendPresence': {
            const type = this.getNodeParameter('presenceType', i) as string;
            const chatJid = this.getNodeParameter('presenceChatJid', i, '') as string;
            if (chatJid) {
              await sock.sendPresenceUpdate(type, chatJid);
            } else {
              await sock.sendPresenceUpdate(type);
            }
            result = { success: true, presenceType: type };
            break;
          }

          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        returnData.push({ json: { operation, backend: backendId, ...(result as object) } });
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

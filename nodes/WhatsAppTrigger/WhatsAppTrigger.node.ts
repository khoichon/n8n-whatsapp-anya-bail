import type {
  ITriggerFunctions,
  INodeType,
  INodeTypeDescription,
  ITriggerResponse,
  IDataObject,
} from 'n8n-workflow';

import { resolveBackendForTrigger, BACKEND_OVERRIDE_PROPERTY } from '../../shared/backends/BackendResolver';
import type { WhatsAppEventName } from '../../shared/backends/Types';

export class WhatsAppTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Trigger',
    name: 'whatsAppTrigger',
    icon: 'file:whatsapp.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["triggerMode"]}}',
    description: 'Triggers a workflow when a WhatsApp event occurs',
    defaults: { name: 'WhatsApp Trigger' },
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'whatsAppSession', required: true }],
    properties: [
      {
        displayName: 'Session ID',
        name: 'sessionId',
        type: 'string',
        default: 'default',
        required: true,
        description: 'The WhatsApp session to listen on',
      },
      BACKEND_OVERRIDE_PROPERTY,
      {
        displayName: 'Trigger Mode',
        name: 'triggerMode',
        type: 'options',
        options: [
          { name: 'Incoming Message (any)', value: 'incomingMessage' },
          { name: 'Incoming Media', value: 'incomingMedia' },
          { name: 'Message Edited', value: 'messageEdited' },
          { name: 'Message Deleted', value: 'messageDeleted' },
          { name: 'Message Reaction', value: 'messageReaction' },
          { name: 'Message Receipt (Delivery/Read)', value: 'messageReceipt' },
          { name: 'Group Update', value: 'groupUpdate' },
          { name: 'Group Participant Change', value: 'groupParticipants' },
          { name: 'Presence Update', value: 'presence' },
          { name: 'Call', value: 'call' },
          { name: 'Connection State Change', value: 'connectionChange' },
          { name: 'Any Event', value: 'any' },
        ],
        default: 'incomingMessage',
        noDataExpression: true,
      },
      {
        displayName: 'Filter by Chat JID',
        name: 'filterJid',
        type: 'string',
        default: '',
        description: 'Only trigger for messages from/to this JID. Leave empty for all.',
        displayOptions: {
          show: { triggerMode: ['incomingMessage', 'incomingMedia', 'messageEdited', 'messageDeleted', 'messageReaction', 'messageReceipt'] },
        },
      },
      {
        displayName: 'Ignore Own Messages',
        name: 'ignoreOwn',
        type: 'boolean',
        default: true,
        description: 'Whether to skip messages sent by this account',
        displayOptions: { show: { triggerMode: ['incomingMessage', 'incomingMedia'] } },
      },
      {
        displayName: 'Specific Event (for Any Event mode)',
        name: 'specificEvent',
        type: 'options',
        options: [
          { name: 'messages.upsert', value: 'messages.upsert' },
          { name: 'messages.update', value: 'messages.update' },
          { name: 'messages.delete', value: 'messages.delete' },
          { name: 'message-receipt.update', value: 'message-receipt.update' },
          { name: 'messages.reaction', value: 'messages.reaction' },
          { name: 'groups.update', value: 'groups.update' },
          { name: 'group-participants.update', value: 'group-participants.update' },
          { name: 'presence.update', value: 'presence.update' },
          { name: 'contacts.update', value: 'contacts.update' },
          { name: 'chats.update', value: 'chats.update' },
          { name: 'connection.update', value: 'connection.update' },
          { name: 'call', value: 'call' },
          { name: 'blocklist.update', value: 'blocklist.update' },
        ],
        default: 'messages.upsert',
        displayOptions: { show: { triggerMode: ['any'] } },
      },
    ],
  };

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const filterJid = this.getNodeParameter('filterJid', '') as string;
    const ignoreOwn = this.getNodeParameter('ignoreOwn', true) as boolean;
    const triggerMode = this.getNodeParameter('triggerMode') as string;

    const { backendId, backend, sessionId } = await resolveBackendForTrigger(this);

    // Ensure session exists
    if (!backend.getSocket(sessionId)) {
      await backend.connect({ sessionId });
    }

    const unsubs: Array<() => void> = [];

    const emit = (data: unknown) => {
      this.emit([[{ json: { ...(data as IDataObject), backend: backendId } }]]);
    };

    const sub = (event: WhatsAppEventName, handler: (data: unknown) => void) => {
      unsubs.push(backend.subscribe(sessionId, event, handler));
    };

    if (triggerMode === 'incomingMessage' || triggerMode === 'incomingMedia') {
      sub('messages.upsert', (data: unknown) => {
        const payload = data as { messages: Array<{ key: { fromMe: boolean; remoteJid: string }; message: unknown }>; type: string };
        if (payload.type !== 'notify') return;

        for (const msg of payload.messages) {
          if (ignoreOwn && msg.key.fromMe) continue;
          if (filterJid && msg.key.remoteJid !== filterJid) continue;

          if (triggerMode === 'incomingMedia') {
            const m = msg.message as Record<string, unknown> | null;
            const hasMedia = m && (
              'imageMessage' in m ||
              'videoMessage' in m ||
              'audioMessage' in m ||
              'documentMessage' in m ||
              'stickerMessage' in m
            );
            if (!hasMedia) continue;
          }

          emit({ event: 'messages.upsert', message: msg, timestamp: Date.now() });
        }
      });
    }

    if (triggerMode === 'messageEdited') {
      sub('messages.update', (data: unknown) => {
        const updates = data as Array<{ key: { remoteJid: string }; update: { message?: unknown } }>;
        for (const upd of updates) {
          if (filterJid && upd.key.remoteJid !== filterJid) continue;
          if (upd.update.message) {
            emit({ event: 'message.edited', update: upd, timestamp: Date.now() });
          }
        }
      });
    }

    if (triggerMode === 'messageDeleted') {
      sub('messages.delete', (data: unknown) => {
        const payload = data as { keys?: Array<{ remoteJid: string }> };
        for (const key of payload.keys ?? []) {
          if (filterJid && key.remoteJid !== filterJid) continue;
          emit({ event: 'message.deleted', key, timestamp: Date.now() });
        }
      });
    }

    if (triggerMode === 'messageReaction') {
      sub('messages.reaction', (data: unknown) => {
        emit({ event: 'messages.reaction', data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'messageReceipt') {
      sub('message-receipt.update', (data: unknown) => {
        emit({ event: 'message-receipt.update', data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'groupUpdate') {
      sub('groups.update', (data: unknown) => {
        emit({ event: 'groups.update', updates: data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'groupParticipants') {
      sub('group-participants.update', (data: unknown) => {
        emit({ event: 'group-participants.update', data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'presence') {
      sub('presence.update', (data: unknown) => {
        emit({ event: 'presence.update', data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'call') {
      sub('call', (data: unknown) => {
        emit({ event: 'call', calls: data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'connectionChange') {
      sub('connection.update', (data: unknown) => {
        emit({ event: 'connection.update', data, timestamp: Date.now() });
      });
    }

    if (triggerMode === 'any') {
      const specificEvent = this.getNodeParameter('specificEvent', 'messages.upsert') as WhatsAppEventName;
      sub(specificEvent, (data: unknown) => {
        emit({ event: specificEvent, data, timestamp: Date.now() });
      });
    }

    async function closeFunction() {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    }

    return { closeFunction };
  }
}

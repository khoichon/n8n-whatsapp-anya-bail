import type {
  ITriggerFunctions,
  INodeType,
  INodeTypeDescription,
  ITriggerResponse,
  IDataObject,
} from 'n8n-workflow';

import { SessionManager } from '../../shared/SessionManager';
import { sanitiseSessionId } from '../../shared/Utils';
import type { SupportedEvent } from '../../shared/Constants';

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
      {
        displayName: 'Trigger Mode',
        name: 'triggerMode',
        type: 'options',
        options: [
          { name: 'Incoming Message (any)', value: 'incomingMessage' },
          { name: 'Incoming Media', value: 'incomingMedia' },
          { name: 'Message Edited', value: 'messageEdited' },
          { name: 'Message Deleted', value: 'messageDeleted' },
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
        displayOptions: { show: { triggerMode: ['incomingMessage', 'incomingMedia', 'messageEdited', 'messageDeleted'] } },
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
    const sessionId = sanitiseSessionId(this.getNodeParameter('sessionId') as string);
    const triggerMode = this.getNodeParameter('triggerMode') as string;
    const filterJid = this.getNodeParameter('filterJid', '') as string;
    const ignoreOwn = this.getNodeParameter('ignoreOwn', true) as boolean;

    const manager = SessionManager.getInstance();

    // Ensure session exists
    if (!manager.get(sessionId)) {
      await manager.create({ sessionId });
    }

    const unsubs: Array<() => void> = [];

    const emit = (data: unknown) => {
      this.emit([[{ json: data as IDataObject }]]);
    };

    if (triggerMode === 'incomingMessage' || triggerMode === 'incomingMedia') {
      const unsub = manager.subscribe(sessionId, 'messages.upsert', (data: unknown) => {
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
      unsubs.push(unsub);
    }

    if (triggerMode === 'messageEdited') {
      const unsub = manager.subscribe(sessionId, 'messages.update', (data: unknown) => {
        const updates = data as Array<{ key: { remoteJid: string }; update: { message?: unknown } }>;
        for (const upd of updates) {
          if (filterJid && upd.key.remoteJid !== filterJid) continue;
          if (upd.update.message) {
            emit({ event: 'message.edited', update: upd, timestamp: Date.now() });
          }
        }
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'messageDeleted') {
      const unsub = manager.subscribe(sessionId, 'messages.delete', (data: unknown) => {
        const payload = data as { keys: Array<{ remoteJid: string }> };
        for (const key of payload.keys) {
          if (filterJid && key.remoteJid !== filterJid) continue;
          emit({ event: 'message.deleted', key, timestamp: Date.now() });
        }
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'groupUpdate') {
      const unsub = manager.subscribe(sessionId, 'groups.update', (data: unknown) => {
        emit({ event: 'groups.update', updates: data, timestamp: Date.now() });
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'groupParticipants') {
      const unsub = manager.subscribe(sessionId, 'group-participants.update', (data: unknown) => {
        emit({ event: 'group-participants.update', data, timestamp: Date.now() });
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'presence') {
      const unsub = manager.subscribe(sessionId, 'presence.update', (data: unknown) => {
        emit({ event: 'presence.update', data, timestamp: Date.now() });
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'call') {
      const unsub = manager.subscribe(sessionId, 'call', (data: unknown) => {
        emit({ event: 'call', calls: data, timestamp: Date.now() });
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'connectionChange') {
      const unsub = manager.subscribe(sessionId, 'connection.update', (data: unknown) => {
        emit({ event: 'connection.update', data, timestamp: Date.now() });
      });
      unsubs.push(unsub);
    }

    if (triggerMode === 'any') {
      const specificEvent = this.getNodeParameter('specificEvent', 'messages.upsert') as SupportedEvent;
      const unsub = manager.subscribe(sessionId, specificEvent, (data: unknown) => {
        emit({ event: specificEvent, data, timestamp: Date.now() });
      });
      unsubs.push(unsub);
    }

    async function closeFunction() {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    }

    return { closeFunction };
  }
}

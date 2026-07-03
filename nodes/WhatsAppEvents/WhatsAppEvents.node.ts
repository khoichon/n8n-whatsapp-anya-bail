import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { resolveBackend, BACKEND_OVERRIDE_PROPERTY } from '../../shared/backends/BackendResolver';
import type { WhatsAppEventName } from '../../shared/backends/Types';

/**
 * WhatsAppEvents — synchronous node that subscribes to an event
 * and waits up to N seconds for the next occurrence, then returns it.
 * Useful for polling / request-response workflows.
 */
export class WhatsAppEvents implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Events',
    name: 'whatsAppEvents',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["event"]}}',
    description: 'Wait for and capture the next WhatsApp event of a specified type',
    defaults: { name: 'WhatsApp Events' },
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
        displayName: 'Event',
        name: 'event',
        type: 'options',
        options: [
          { name: 'messages.upsert — Incoming Messages', value: 'messages.upsert' },
          { name: 'messages.update — Message Status Update', value: 'messages.update' },
          { name: 'messages.delete — Message Deleted', value: 'messages.delete' },
          { name: 'messages.reaction — Reaction Received', value: 'messages.reaction' },
          { name: 'message-receipt.update — Delivery/Read Receipt', value: 'message-receipt.update' },
          { name: 'groups.update — Group Updated', value: 'groups.update' },
          { name: 'group-participants.update — Participant Change', value: 'group-participants.update' },
          { name: 'presence.update — Presence Changed', value: 'presence.update' },
          { name: 'contacts.update — Contacts Updated', value: 'contacts.update' },
          { name: 'chats.update — Chats Updated', value: 'chats.update' },
          { name: 'connection.update — Connection State', value: 'connection.update' },
          { name: 'call — Incoming/Outgoing Call', value: 'call' },
          { name: 'blocklist.update — Blocklist Changed', value: 'blocklist.update' },
        ],
        default: 'messages.upsert',
        noDataExpression: true,
      },
      {
        displayName: 'Timeout (seconds)',
        name: 'timeout',
        type: 'number',
        default: 30,
        description: 'How long to wait for the event. Use 0 to return immediately with last cached event.',
      },
      {
        displayName: 'Return If Timeout',
        name: 'returnOnTimeout',
        type: 'boolean',
        default: false,
        description: 'Whether to return an empty result on timeout instead of throwing an error',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const event = this.getNodeParameter('event', i) as WhatsAppEventName;
      const timeoutSecs = this.getNodeParameter('timeout', i, 30) as number;
      const returnOnTimeout = this.getNodeParameter('returnOnTimeout', i, false) as boolean;

      try {
        const { backendId, backend, sessionId } = await resolveBackend(this, i);

        if (!backend.getSocket(sessionId)) {
          await backend.connect({ sessionId });
        }

        const data = await new Promise<unknown>((resolve, reject) => {
          let settled = false;

          const unsub = backend.subscribe(sessionId, event, (eventData: unknown) => {
            if (settled) return;
            settled = true;
            unsub();
            resolve(eventData);
          });

          if (timeoutSecs > 0) {
            setTimeout(() => {
              if (settled) return;
              settled = true;
              unsub();
              if (returnOnTimeout) {
                resolve(null);
              } else {
                reject(new Error(`Timeout waiting for event "${event}" after ${timeoutSecs}s`));
              }
            }, timeoutSecs * 1000);
          }
        });

        if (data === null) {
          returnData.push({ json: { event, backend: backendId, timedOut: true, data: null } });
        } else {
          returnData.push({ json: { event, backend: backendId, timedOut: false, data, capturedAt: new Date().toISOString() } });
        }
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

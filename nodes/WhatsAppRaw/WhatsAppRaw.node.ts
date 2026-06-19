import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { SessionManager } from '../../shared/SessionManager';
import { sanitiseSessionId } from '../../shared/Utils';

export class WhatsAppRaw implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Raw',
    name: 'whatsAppRaw',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    description:
      'Execute raw JavaScript against a WhatsApp socket. Access the full anya-bail API directly.',
    defaults: { name: 'WhatsApp Raw' },
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
        description: 'The WhatsApp session whose socket to use',
      },
      {
        displayName: 'JavaScript Code',
        name: 'code',
        type: 'string',
        typeOptions: {
          editor: 'jsEditor',
          rows: 20,
        },
        default: `// Available variables:
// sock     — the Baileys WASocket for this session
// items    — the n8n input items array
// helpers  — n8n helpers (getBinaryDataBuffer, etc.)
// require  — Node.js require

// Example: fetch all participating groups
const groups = await sock.groupFetchAllParticipating();
return Object.values(groups);

// Example: send a message
// await sock.sendMessage('1234567890@s.whatsapp.net', { text: 'Hello!' });
// return [{ success: true }];

// Example: check if a number exists
// const [result] = await sock.onWhatsApp('1234567890@s.whatsapp.net');
// return result;`,
        description: 'JavaScript code to execute. Must return a value (array, object, or primitive). Use "return" to output results.',
        noDataExpression: true,
      },
      {
        displayName: 'Wrap Result as Array',
        name: 'wrapArray',
        type: 'boolean',
        default: true,
        description: 'Whether to automatically wrap non-array results in an array for n8n item output',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const manager = SessionManager.getInstance();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const sessionId = sanitiseSessionId(this.getNodeParameter('sessionId', i) as string);
      const code = this.getNodeParameter('code', i) as string;
      const wrapArray = this.getNodeParameter('wrapArray', i, true) as boolean;

      try {
        const sock = manager.getOrThrow(sessionId);
        const helpers = this.helpers;

        // Build and execute the async function with the user's code
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function(
          'sock',
          'items',
          'helpers',
          'require',
          `return (async () => { ${code} })();`,
        );

        let result: unknown;
        try {
          result = await fn(sock, items, helpers, require);
        } catch (execErr) {
          throw new Error(`Code execution error: ${(execErr as Error).message}`);
        }

        if (result === undefined || result === null) {
          returnData.push({ json: { result: null } });
          continue;
        }

        if (Array.isArray(result)) {
          for (const item of result) {
            if (item !== null && typeof item === 'object') {
              returnData.push({ json: item as IDataObject });
            } else {
              returnData.push({ json: { value: item } });
            }
          }
        } else if (wrapArray) {
          if (typeof result === 'object') {
            returnData.push({ json: result as IDataObject });
          } else {
            returnData.push({ json: { result } });
          }
        } else {
          returnData.push({ json: { result } });
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

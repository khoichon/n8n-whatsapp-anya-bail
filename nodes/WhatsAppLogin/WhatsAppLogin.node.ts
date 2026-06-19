import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { SessionManager } from '../../shared/SessionManager';
import { generateQRBuffer } from '../../shared/QRGenerator';
import { sanitiseSessionId } from '../../shared/Utils';
import { sessionExists } from '../../shared/SessionStore';

export class WhatsAppLogin implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Login',
    name: 'whatsAppLogin',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Manage WhatsApp sessions: connect, disconnect, view QR codes and session status',
    defaults: { name: 'WhatsApp Login' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'whatsAppSession',
        required: false,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Connect / Get QR', value: 'connect', description: 'Start a session and retrieve the QR code or pairing code' },
          { name: 'Generate Pairing Code', value: 'pairingCode', description: 'Generate a pairing code for phone-number-based auth' },
          { name: 'Get Status', value: 'status', description: 'Get the current connection status of a session' },
          { name: 'List Sessions', value: 'listSessions', description: 'List all known WhatsApp sessions' },
          { name: 'Disconnect', value: 'disconnect', description: 'Disconnect a session without deleting credentials' },
          { name: 'Delete Session', value: 'deleteSession', description: 'Disconnect and permanently delete all session data' },
        ],
        default: 'connect',
      },
      {
        displayName: 'Session ID',
        name: 'sessionId',
        type: 'string',
        default: 'default',
        required: true,
        description: 'Unique name for this WhatsApp session',
        displayOptions: {
          show: { operation: ['connect', 'pairingCode', 'status', 'disconnect', 'deleteSession'] },
        },
      },
      {
        displayName: 'Phone Number',
        name: 'pairingPhone',
        type: 'string',
        default: '',
        placeholder: '+1234567890',
        required: true,
        description: 'Phone number in international format for pairing code generation',
        displayOptions: {
          show: { operation: ['pairingCode'] },
        },
      },
      {
        displayName: 'Include QR Image',
        name: 'includeQRImage',
        type: 'boolean',
        default: true,
        description: 'Whether to include a PNG QR code image as binary data in the output',
        displayOptions: {
          show: { operation: ['connect'] },
        },
      },
      {
        displayName: 'Wait For QR (seconds)',
        name: 'waitForQR',
        type: 'number',
        default: 30,
        description: 'How long to wait for a QR code to appear before returning. Set 0 to return immediately.',
        displayOptions: {
          show: { operation: ['connect'] },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const manager = SessionManager.getInstance();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;

      try {
        if (operation === 'listSessions') {
          const sessions = manager.listSessions();
          returnData.push({ json: { sessions, count: sessions.length } });
          continue;
        }

        const rawSessionId = this.getNodeParameter('sessionId', i) as string;
        const sessionId = sanitiseSessionId(rawSessionId);

        if (operation === 'status') {
          const sessions = manager.listSessions();
          const info = sessions.find(s => s.sessionId === sessionId);
          if (!info) {
            returnData.push({
              json: {
                sessionId,
                connected: false,
                exists: sessionExists(sessionId),
                message: 'Session not active in memory',
              },
            });
          } else {
            returnData.push({ json: info as unknown as IDataObject });
          }
          continue;
        }

        if (operation === 'disconnect') {
          await manager.disconnect(sessionId);
          returnData.push({ json: { sessionId, disconnected: true } });
          continue;
        }

        if (operation === 'deleteSession') {
          await manager.delete(sessionId);
          returnData.push({ json: { sessionId, deleted: true } });
          continue;
        }

        if (operation === 'pairingCode') {
          const phone = this.getNodeParameter('pairingPhone', i) as string;
          // Create session with pairing
          await manager.create({ sessionId, usePairingCode: true, pairingPhone: phone });
          // Wait up to 30s for code
          let code: string | undefined;
          for (let t = 0; t < 30; t++) {
            code = manager.getPairingCode(sessionId);
            if (code) break;
            await new Promise(r => setTimeout(r, 1000));
          }
          returnData.push({
            json: {
              sessionId,
              pairingCode: code ?? null,
              phone,
              message: code ? 'Enter this code in WhatsApp > Linked Devices > Link a Device' : 'Pairing code not yet generated',
            },
          });
          continue;
        }

        if (operation === 'connect') {
          const waitSecs = this.getNodeParameter('waitForQR', i, 30) as number;
          const includeImage = this.getNodeParameter('includeQRImage', i, true) as boolean;

          await manager.create({ sessionId });

          // Wait for QR or connected state
          let qr: string | undefined;
          let connected = false;
          const startMs = Date.now();
          const waitMs = waitSecs * 1000;

          while (Date.now() - startMs < waitMs) {
            const info = manager.listSessions().find(s => s.sessionId === sessionId);
            if (info?.connected) { connected = true; break; }
            if (info?.qrCode) { qr = info.qrCode; break; }
            await new Promise(r => setTimeout(r, 500));
          }

          if (connected) {
            const info = manager.listSessions().find(s => s.sessionId === sessionId)!;
            returnData.push({
              json: {
                sessionId,
                connected: true,
                phone: info.phone,
                pushName: info.pushName,
                message: 'Session is already connected',
              },
            });
            continue;
          }

          const result: INodeExecutionData = {
            json: {
              sessionId,
              connected: false,
              qrCode: qr ?? null,
              message: qr ? 'Scan the QR code with WhatsApp' : 'QR code not yet available, check again shortly',
            },
          };

          if (qr && includeImage) {
            try {
              const qrBuf = await generateQRBuffer(qr);
              result.binary = {
                qrImage: await this.helpers.prepareBinaryData(qrBuf, `qr_${sessionId}.bmp`, 'image/bmp'),
              };
            } catch { /* non-critical */ }
          }

          returnData.push(result);
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
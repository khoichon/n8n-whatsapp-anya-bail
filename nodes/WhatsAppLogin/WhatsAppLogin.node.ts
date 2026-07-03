import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { generateQRBuffer as legacyGenerateQRBuffer } from '../../shared/QRGenerator';
import { generateQRBuffer as officialGenerateQRBuffer } from '../../shared/backends/StorageKit';
import { resolveBackend, getBackendInstance, BACKEND_OVERRIDE_PROPERTY } from '../../shared/backends/BackendResolver';

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
      {
        ...BACKEND_OVERRIDE_PROPERTY,
        displayOptions: {
          show: { operation: ['connect', 'pairingCode', 'status', 'disconnect', 'deleteSession'] },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;

      try {
        if (operation === 'listSessions') {
          // Not scoped to a single session — list across BOTH backends
          // so nothing already-connected is hidden from the user.
          const legacySessions = getBackendInstance('legacy').listSessions();
          const officialSessions = getBackendInstance('official').listSessions();
          const sessions = [...legacySessions, ...officialSessions];
          returnData.push({ json: { sessions: sessions as unknown as IDataObject[], count: sessions.length } });
          continue;
        }

        const { backendId, backend, sessionId } = await resolveBackend(this, i);

        if (operation === 'status') {
          const info = backend.getSessionInfo(sessionId);
          if (!info) {
            returnData.push({
              json: {
                sessionId,
                backend: backendId,
                connected: false,
                exists: backend.sessionExistsOnDisk(sessionId),
                message: 'Session not active in memory',
              },
            });
          } else {
            returnData.push({ json: info as unknown as IDataObject });
          }
          continue;
        }

        if (operation === 'disconnect') {
          await backend.disconnect(sessionId);
          returnData.push({ json: { sessionId, backend: backendId, disconnected: true } });
          continue;
        }

        if (operation === 'deleteSession') {
          await backend.deleteSession(sessionId);
          returnData.push({ json: { sessionId, backend: backendId, deleted: true } });
          continue;
        }

        if (operation === 'pairingCode') {
          const phone = this.getNodeParameter('pairingPhone', i) as string;
          await backend.connect({ sessionId, usePairingCode: true, pairingPhone: phone });
          let code: string | undefined;
          for (let t = 0; t < 30; t++) {
            code = backend.getPairingCode(sessionId);
            if (code) break;
            await new Promise(r => setTimeout(r, 1000));
          }
          returnData.push({
            json: {
              sessionId,
              backend: backendId,
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

          await backend.connect({ sessionId });

          let qr: string | undefined;
          let connected = false;
          const startMs = Date.now();
          const waitMs = waitSecs * 1000;

          while (Date.now() - startMs < waitMs) {
            const info = backend.getSessionInfo(sessionId);
            if (info?.connected) {
              connected = true;
              break;
            }
            if (info?.qrCode) {
              qr = info.qrCode;
              break;
            }
            await new Promise(r => setTimeout(r, 500));
          }

          if (connected) {
            const info = backend.getSessionInfo(sessionId)!;
            returnData.push({
              json: {
                sessionId,
                backend: backendId,
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
              backend: backendId,
              connected: false,
              qrCode: qr ?? null,
              message: qr ? 'Scan the QR code with WhatsApp' : 'QR code not yet available, check again shortly',
            },
          };

          if (qr && includeImage) {
            try {
              const qrBuf = backendId === 'official' ? await officialGenerateQRBuffer(qr) : await legacyGenerateQRBuffer(qr);
              result.binary = {
                qrImage: await this.helpers.prepareBinaryData(qrBuf, `qr_${sessionId}.bmp`, 'image/bmp'),
              };
            } catch {
              /* non-critical */
            }
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

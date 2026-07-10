import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// Bootstrap sessions on node load
import '../../shared/Bootstrap';

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
          { name: 'Connect', value: 'connect', description: 'Connect or reconnect a session using existing credentials' },
          { name: 'Get Code / Status', value: 'getCode', description: 'Get the current QR code or pairing code (auto-generated on boot)' },
          { name: 'Get Detailed Status', value: 'status', description: 'Get the current connection status of a session' },
          { name: 'List Sessions', value: 'listSessions', description: 'List all known WhatsApp sessions' },
          { name: 'Disconnect', value: 'disconnect', description: 'Disconnect a session without deleting credentials' },
          { name: 'Delete Session', value: 'deleteSession', description: 'Disconnect and permanently delete all session data' },
        ],
        default: 'getCode',
      },
      {
        displayName: 'Session ID',
        name: 'sessionId',
        type: 'string',
        default: 'default',
        required: true,
        description: 'Unique name for this WhatsApp session',
        displayOptions: {
          show: { operation: ['getCode', 'status', 'connect', 'disconnect', 'deleteSession'] },
        },
      },
      {
        displayName: 'Include QR Image',
        name: 'includeQRImage',
        type: 'boolean',
        default: true,
        description: 'Whether to include a PNG QR code image as binary data in the output (only applies to QR authentication)',
        displayOptions: {
          show: { operation: ['getCode'] },
        },
      },
      {
        displayName: 'Wait For Code (seconds)',
        name: 'waitForCode',
        type: 'number',
        default: 30,
        description: 'How long to wait for a QR/pairing code to appear before returning. Set 0 to return immediately.',
        displayOptions: {
          show: { operation: ['getCode'] },
        },
      },
      {
        ...BACKEND_OVERRIDE_PROPERTY,
        displayOptions: {
          show: { operation: ['getCode', 'status', 'connect', 'disconnect', 'deleteSession'] },
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

        if (operation === 'connect') {
          // Read current credential settings to determine auth method
          const credentials = await this.getCredentials('whatsAppSession', i);
          const authMethod = credentials?.authMethod as 'qr' | 'pairing' | undefined;
          const pairingPhone = credentials?.pairingPhone as string | undefined;

          console.log(`[WhatsAppLogin] Connecting session with authMethod=${authMethod}, pairingPhone=${pairingPhone}`);

          // Connect session with current credential settings
          await backend.connect({
            sessionId,
            usePairingCode: authMethod === 'pairing',
            pairingPhone: pairingPhone,
          });

          // Wait a moment for connection to establish
          await new Promise(r => setTimeout(r, 2000));

          // Return connection status
          const info = backend.getSessionInfo(sessionId);
          returnData.push({
            json: {
              sessionId,
              backend: backendId,
              connected: info?.connected ?? false,
              phone: info?.phone,
              pushName: info?.pushName,
              message: info?.connected ? 'Session connected successfully' : 'Session initiated, waiting for connection...',
            } as IDataObject,
          });
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

        if (operation === 'getCode') {
          const waitSecs = this.getNodeParameter('waitForCode', i, 30) as number;
          const includeImage = this.getNodeParameter('includeQRImage', i, true) as boolean;

          // Check if session exists, if not create it using current credential settings
          let info = backend.getSessionInfo(sessionId);
          let authMethod: 'qr' | 'pairing' | undefined;
          let pairingPhone: string | undefined;

          if (!info) {
            // Session doesn't exist - need to create it first
            // Read current credential settings to determine auth method
            const credentials = await this.getCredentials('whatsAppSession', i);
            authMethod = credentials?.authMethod as 'qr' | 'pairing' | undefined;
            pairingPhone = credentials?.pairingPhone as string | undefined;

            console.log(`[WhatsAppLogin] Creating session with authMethod=${authMethod}, pairingPhone=${pairingPhone}`);

            // Create session with current credential settings
            await backend.connect({
              sessionId,
              usePairingCode: authMethod === 'pairing',
              pairingPhone: pairingPhone,
            });
          }

          // If authMethod wasn't determined from credentials (session existed), check metadata
          if (!authMethod) {
            const credentials = await this.getCredentials('whatsAppSession', i);
            authMethod = credentials?.authMethod as 'qr' | 'pairing' | undefined;
            pairingPhone = credentials?.pairingPhone as string | undefined;
            console.log(`[WhatsAppLogin] Existing session, authMethod from credentials=${authMethod}, pairingPhone=${pairingPhone}`);

            // For pairing mode, ensure the session is properly connected with a pairing code
            // If the session was restored by Bootstrap but the pairing code wasn't generated,
            // we need to reconnect to trigger the pairing code generation
            if (authMethod === 'pairing' && pairingPhone) {
              const pollInfo = backend.getSessionInfo(sessionId);
              if (!pollInfo?.pairingCode && !pollInfo?.connected) {
                console.log(`[WhatsAppLogin] No pairing code found and not connected, reconnecting with pairing mode...`);
                await backend.connect({
                  sessionId,
                  usePairingCode: true,
                  pairingPhone: pairingPhone,
                });
              }
            }
          }

          // Poll for QR/pairing code or connection
          const qrTimeoutSeconds = 20; // QR codes typically rotate every ~20 seconds
          let code: string | undefined;
          let connected = false;
          const startMs = Date.now();
          const waitMs = waitSecs * 1000;

          console.log(`[WhatsAppLogin] Polling for code, authMode=${authMethod}, timeout=${waitSecs}s`);

          // Poll for QR/pairing code or connection
          while (Date.now() - startMs < waitMs) {
            const pollInfo = backend.getSessionInfo(sessionId);
            if (pollInfo?.connected) {
              connected = true;
              break;
            }

            // In pairing mode, only look for pairing code. In QR mode, only look for QR code.
            if (authMethod === 'pairing') {
              if (pollInfo?.pairingCode) {
                code = pollInfo.pairingCode;
                console.log(`[WhatsAppLogin] Found pairing code: ${code}`);
                break;
              }
            } else {
              // Default to QR mode
              if (pollInfo?.qrCode) {
                code = pollInfo.qrCode;
                console.log(`[WhatsAppLogin] Found QR code`);
                break;
              }
            }
            await new Promise(r => setTimeout(r, 500));
          }

          // Return connection result
          if (connected) {
            const finalInfo = backend.getSessionInfo(sessionId)!;
            returnData.push({
              json: {
                sessionId,
                backend: backendId,
                connected: true,
                phone: finalInfo.phone,
                pushName: finalInfo.pushName,
                message: 'Session is already connected',
              },
            });
            continue;
          }

          // Return code for user to complete authentication
          const finalInfo = backend.getSessionInfo(sessionId);
          const isPairingCode = authMethod === 'pairing';

          console.log(`[WhatsAppLogin] Returning result: isPairingCode=${isPairingCode}, code=${code ? 'present' : 'missing'}`);

          const result: INodeExecutionData = {
            json: {
              sessionId,
              backend: backendId,
              connected: false,
              authMethod: isPairingCode ? 'pairing' : 'qr',
              // Include timeout information
              codeTimeoutSeconds: qrTimeoutSeconds,
              codeExpiresAt: new Date(Date.now() + qrTimeoutSeconds * 1000).toISOString(),
            },
          };

          if (isPairingCode) {
            result.json = {
              ...result.json,
              pairingCode: code ?? null,
              phone: finalInfo?.phone,
              message: code
                ? `Enter this code in WhatsApp > Linked Devices > Link a Device. Code expires in ${qrTimeoutSeconds} seconds.`
                : 'Pairing code not yet generated, check again shortly',
              debug: backend.getPairingDebug(sessionId),
            };
          } else {
            result.json = {
              ...result.json,
              qrCode: code ?? null,
              message: code
                ? `Scan the QR code with WhatsApp. Code expires in ${qrTimeoutSeconds} seconds.`
                : 'QR code not yet available, check again shortly',
            };

            // Include QR image only if code exists AND image is requested AND we're in QR mode
            if (code && includeImage && !isPairingCode) {
              try {
                const qrBuf = backendId === 'official' ? await officialGenerateQRBuffer(code) : await legacyGenerateQRBuffer(code);
                result.binary = {
                  qrImage: await this.helpers.prepareBinaryData(qrBuf, `qr_${sessionId}.bmp`, 'image/bmp'),
                };
              } catch {
                /* non-critical */
              }
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

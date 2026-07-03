import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class WhatsAppSession implements ICredentialType {
  name = 'whatsAppSession';
  displayName = 'WhatsApp Session';
  documentationUrl = 'https://github.com/your-org/n8n-nodes-whatsapp-baileys';
  properties: INodeProperties[] = [
    {
      displayName: 'Backend',
      name: 'backend',
      type: 'options',
      options: [
        { name: 'Legacy (anya-bail)', value: 'legacy' },
        { name: 'Official Baileys', value: 'official' },
      ],
      default: 'legacy',
      description:
        'Which WhatsApp SDK to connect through. Existing credentials default to "Legacy" so upgrading this package never changes behaviour unless you explicitly opt in to "Official Baileys" here.',
    },
    {
      displayName: 'Session ID',
      name: 'sessionId',
      type: 'string',
      default: 'default',
      required: true,
      description:
        'Unique identifier for this WhatsApp session. Use different IDs to manage multiple WhatsApp accounts simultaneously.',
    },
    {
      displayName: 'Authentication Method',
      name: 'authMethod',
      type: 'options',
      options: [
        { name: 'QR Code', value: 'qr' },
        { name: 'Pairing Code', value: 'pairing' },
      ],
      default: 'qr',
      description: 'How to authenticate this WhatsApp session',
    },
    {
      displayName: 'Phone Number (for Pairing Code)',
      name: 'pairingPhone',
      type: 'string',
      default: '',
      placeholder: '+1234567890',
      description: 'Phone number in international format. Required when using Pairing Code auth.',
      displayOptions: {
        show: { authMethod: ['pairing'] },
      },
    },
    {
      displayName: 'Auto-Reconnect',
      name: 'autoReconnect',
      type: 'boolean',
      default: true,
      description: 'Whether to automatically reconnect when the connection drops',
    },
    {
      displayName: 'Session Storage Path',
      name: 'storagePath',
      type: 'string',
      default: '',
      placeholder: '~/.n8n/whatsapp/sessions',
      description:
        'Override the default session storage path. Leave empty to use the default (~/.n8n/whatsapp/sessions).',
    },
  ];
}

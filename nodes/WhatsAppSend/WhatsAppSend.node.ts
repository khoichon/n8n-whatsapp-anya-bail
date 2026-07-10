import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
  buildTextContent,
  buildImageContent,
  buildVideoContent,
  buildAudioContent,
  buildDocumentContent,
  buildLocationContent,
  buildContactContent,
  buildPollContent,
  buildReactionContent,
  buildButtonsContent,
  buildListContent,
  sendMessage,
  type WAMessage,
} from '../../shared/MessageHelpers';
import * as GroupHelpers from '../../shared/GroupHelpers';
import { normaliseJid, normaliseGroupJid } from '../../shared/Utils';
import type { MediaInput } from '../../shared/Types';
import { resolveBackend, BACKEND_OVERRIDE_PROPERTY } from '../../shared/backends/BackendResolver';
import { assertCapability } from '../../shared/backends/assertCapability';

const MEDIA_TYPE_PROP = {
  displayName: 'Media Source',
  name: 'mediaSource',
  type: 'options' as const,
  options: [
    { name: 'URL', value: 'url' },
    { name: 'Binary Data (from previous node)', value: 'binary' },
    { name: 'Base64 String', value: 'base64' },
    { name: 'Local File Path', value: 'path' },
  ],
  default: 'url',
};

export class WhatsAppSend implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'WhatsApp Send',
    name: 'whatsAppSend',
    icon: 'file:whatsapp.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Send WhatsApp messages: text, media, polls, buttons, and more',
    defaults: { name: 'WhatsApp Send' },
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
        description: 'The WhatsApp session to use',
      },
      BACKEND_OVERRIDE_PROPERTY,
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Text', value: 'text' },
          { name: 'Image', value: 'image' },
          { name: 'Video', value: 'video' },
          { name: 'Audio', value: 'audio' },
          { name: 'Voice Note (PTT)', value: 'voiceNote' },
          { name: 'Document', value: 'document' },
          { name: 'Sticker', value: 'sticker' },
          { name: 'Location', value: 'location' },
          { name: 'Contact (vCard)', value: 'contact' },
          { name: 'Poll', value: 'poll' },
          { name: 'Reaction', value: 'reaction' },
          { name: 'Buttons', value: 'buttons' },
          { name: 'List Message', value: 'list' },
          { name: 'Forward Message', value: 'forward' },
          { name: 'Delete Message', value: 'deleteMessage' },
          { name: 'Edit Message', value: 'editMessage' },
          { name: 'Pin Message', value: 'pinMessage' },
          { name: 'Unpin Message', value: 'unpinMessage' },
        ],
        default: 'text',
      },

      // ── Common ──
      {
        displayName: 'To (JID or Phone Number)',
        name: 'to',
        type: 'string',
        default: '',
        required: true,
        placeholder: '1234567890 or 1234567890@s.whatsapp.net',
        description: 'Recipient phone number or WhatsApp JID. For groups, use the group JID ending in @g.us.',
        displayOptions: {
          hide: { operation: ['deleteMessage', 'pinMessage', 'unpinMessage'] },
        },
      },

      // ── Text ──
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        required: true,
        displayOptions: { show: { operation: ['text', 'editMessage'] } },
      },

      // ── Mentions ──
      {
        displayName: 'Mention Users',
        name: 'mentionUsers',
        type: 'string',
        default: '',
        placeholder: '+1234567890, +0987654321',
        description:
          'Comma-separated phone numbers to @mention. The numbers should also appear in the message text (e.g. "Hi @1234567890") for WhatsApp to render the mention — this field only controls who gets notified/highlighted.',
        displayOptions: { show: { operation: ['text', 'image', 'video'] } },
      },
      {
        displayName: 'Mention All Group Participants',
        name: 'mentionAll',
        type: 'boolean',
        default: false,
        description: 'Whether to @mention every participant of the destination group (ignored for non-group chats). Adds to, does not replace, "Mention Users".',
        displayOptions: { show: { operation: ['text', 'image', 'video'] } },
      },

      // ── Image / Video ──
      {
        ...MEDIA_TYPE_PROP,
        displayOptions: { show: { operation: ['image', 'video', 'audio', 'voiceNote', 'document', 'sticker'] } },
      },
      {
        displayName: 'URL',
        name: 'mediaUrl',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['image', 'video', 'audio', 'voiceNote', 'document', 'sticker'], mediaSource: ['url'] } },
      },
      {
        displayName: 'Binary Property',
        name: 'binaryPropertyName',
        type: 'string',
        default: 'data',
        displayOptions: { show: { operation: ['image', 'video', 'audio', 'voiceNote', 'document', 'sticker'], mediaSource: ['binary'] } },
      },
      {
        displayName: 'Base64 Data',
        name: 'base64Data',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['image', 'video', 'audio', 'voiceNote', 'document', 'sticker'], mediaSource: ['base64'] } },
      },
      {
        displayName: 'File Path',
        name: 'filePath',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['image', 'video', 'audio', 'voiceNote', 'document', 'sticker'], mediaSource: ['path'] } },
      },
      {
        displayName: 'Caption',
        name: 'caption',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['image', 'video', 'document'] } },
      },
      {
        displayName: 'MIME Type',
        name: 'mimeType',
        type: 'string',
        default: '',
        placeholder: 'image/jpeg',
        description: 'Override detected MIME type',
        displayOptions: { show: { operation: ['audio', 'voiceNote', 'document', 'sticker'] } },
      },
      {
        displayName: 'File Name',
        name: 'fileName',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['document'] } },
      },

      // ── Location ──
      {
        displayName: 'Latitude',
        name: 'latitude',
        type: 'number',
        default: 0,
        displayOptions: { show: { operation: ['location'] } },
      },
      {
        displayName: 'Longitude',
        name: 'longitude',
        type: 'number',
        default: 0,
        displayOptions: { show: { operation: ['location'] } },
      },
      {
        displayName: 'Location Name',
        name: 'locationName',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['location'] } },
      },
      {
        displayName: 'Address',
        name: 'locationAddress',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['location'] } },
      },

      // ── Contact ──
      {
        displayName: 'Display Name',
        name: 'contactDisplayName',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['contact'] } },
      },
      {
        displayName: 'vCard String',
        name: 'vcard',
        type: 'string',
        typeOptions: { rows: 6 },
        default: 'BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nTEL:+1234567890\nEND:VCARD',
        displayOptions: { show: { operation: ['contact'] } },
      },

      // ── Poll ──
      {
        displayName: 'Poll Question',
        name: 'pollName',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['poll'] } },
      },
      {
        displayName: 'Poll Options',
        name: 'pollOptions',
        type: 'string',
        default: '',
        placeholder: 'Option 1, Option 2, Option 3',
        description: 'Comma-separated list of poll options',
        displayOptions: { show: { operation: ['poll'] } },
      },
      {
        displayName: 'Max Selectable',
        name: 'pollSelectable',
        type: 'number',
        default: 1,
        displayOptions: { show: { operation: ['poll'] } },
      },

      // ── Reaction ──
      {
        displayName: 'Reaction Emoji',
        name: 'reactionEmoji',
        type: 'string',
        default: '👍',
        description: 'Emoji to react with. Leave empty to remove reaction.',
        displayOptions: { show: { operation: ['reaction'] } },
      },
      {
        displayName: 'Target Message ID',
        name: 'targetMessageId',
        type: 'string',
        default: '',
        description: 'The ID of the message to react to',
        displayOptions: { show: { operation: ['reaction', 'forward', 'deleteMessage', 'editMessage', 'pinMessage', 'unpinMessage'] } },
      },
      {
        displayName: 'Target Message JID',
        name: 'targetMessageJid',
        type: 'string',
        default: '',
        description: 'The JID of the chat containing the target message',
        displayOptions: { show: { operation: ['reaction', 'deleteMessage', 'editMessage', 'pinMessage', 'unpinMessage'] } },
      },
      {
        displayName: 'Target Message From Me',
        name: 'targetFromMe',
        type: 'boolean',
        default: false,
        displayOptions: { show: { operation: ['reaction', 'forward', 'deleteMessage', 'editMessage', 'pinMessage', 'unpinMessage'] } },
      },

      // ── Buttons ──
      {
        displayName: 'Button Body Text',
        name: 'buttonBody',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['buttons'] } },
      },
      {
        displayName: 'Buttons',
        name: 'buttons',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        displayOptions: { show: { operation: ['buttons'] } },
        options: [
          {
            name: 'button',
            displayName: 'Button',
            values: [
              { displayName: 'Button ID', name: 'id', type: 'string', default: '' },
              { displayName: 'Button Label', name: 'label', type: 'string', default: '' },
            ],
          },
        ],
      },
      {
        displayName: 'Footer',
        name: 'footer',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['buttons', 'list'] } },
      },

      // ── List ──
      {
        displayName: 'List Body Text',
        name: 'listBody',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['list'] } },
      },
      {
        displayName: 'List Button Text',
        name: 'listButtonText',
        type: 'string',
        default: 'Open List',
        displayOptions: { show: { operation: ['list'] } },
      },
      {
        displayName: 'List Title',
        name: 'listTitle',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['list'] } },
      },
      {
        displayName: 'Sections (JSON)',
        name: 'listSectionsJson',
        type: 'string',
        typeOptions: { rows: 6 },
        default: '[{"title":"Section 1","rows":[{"id":"row1","title":"Option 1","description":"Description"}]}]',
        description: 'JSON array of sections with rows',
        displayOptions: { show: { operation: ['list'] } },
      },

      // ── Forward ──
      {
        displayName: 'Forward To',
        name: 'forwardTo',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['forward'] } },
      },
      // ── Delete ──
      { 
        displayName: 'Target Participant',
        name:'targetParticipantId', 
        type:'string', 
        default:'', 
        description:'The person who sent the target message to be deleted', 
        displayOptions: { show: { operation: ['deleteMessage'] } }, },

      // ── Pin duration ──
      {
        displayName: 'Pin Duration (seconds)',
        name: 'pinDuration',
        type: 'options',
        options: [
          { name: '24 hours', value: 86400 },
          { name: '7 days', value: 604800 },
          { name: '30 days', value: 2592000 },
        ],
        default: 86400,
        displayOptions: { show: { operation: ['pinMessage'] } },
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
        const capabilities = backend.capabilities;
        const sock = backend.getOrThrowSocket(sessionId);

        const MEDIA_OPS = new Set(['image', 'video', 'audio', 'voiceNote', 'document', 'sticker']);
        if (MEDIA_OPS.has(operation)) assertCapability(this, backendId, capabilities, 'media', i);
        if (operation === 'poll') assertCapability(this, backendId, capabilities, 'polls', i);
        if (operation === 'reaction') assertCapability(this, backendId, capabilities, 'reactions', i);
        if (operation === 'buttons') assertCapability(this, backendId, capabilities, 'buttons', i);
        if (operation === 'list') assertCapability(this, backendId, capabilities, 'lists', i);
        if (operation === 'editMessage') assertCapability(this, backendId, capabilities, 'editing', i);

        if (operation === 'deleteMessage') {
          const msgId = this.getNodeParameter('targetMessageId', i) as string;
          const msgJid = this.getNodeParameter('targetMessageJid', i) as string;
          const fromMe = this.getNodeParameter('targetFromMe', i) as boolean;
          const participant = this.getNodeParameter('targetParticipantId') as string;
          await sock.sendMessage(msgJid, { delete: { id: msgId, remoteJid: msgJid, participant, fromMe } });
          returnData.push({ json: { success: true, operation, messageId: msgId } });
          continue;
        }

        if (operation === 'pinMessage') {
          const msgId = this.getNodeParameter('targetMessageId', i) as string;
          const msgJid = this.getNodeParameter('targetMessageJid', i) as string;
          const fromMe = this.getNodeParameter('targetFromMe', i) as boolean;
          const duration = this.getNodeParameter('pinDuration', i, 86400) as number;
          await sock.sendMessage(msgJid, {
            pin: { type: 1, time: duration },
            key: { id: msgId, remoteJid: msgJid, fromMe },
          });
          returnData.push({ json: { success: true, operation, messageId: msgId } });
          continue;
        }

        if (operation === 'unpinMessage') {
          const msgId = this.getNodeParameter('targetMessageId', i) as string;
          const msgJid = this.getNodeParameter('targetMessageJid', i) as string;
          const fromMe = this.getNodeParameter('targetFromMe', i) as boolean;
          await sock.sendMessage(msgJid, {
            pin: { type: 2, time: 0 },
            key: { id: msgId, remoteJid: msgJid, fromMe },
          });
          returnData.push({ json: { success: true, operation, messageId: msgId } });
          continue;
        }

        const rawTo = this.getNodeParameter('to', i, '') as string;
        const to = rawTo.includes('@g.us') ? normaliseGroupJid(rawTo) : normaliseJid(rawTo);

        let content;
        let sent: WAMessage | undefined;

        switch (operation) {
          case 'text': {
            const text = this.getNodeParameter('text', i) as string;
            const mentions = await resolveMentions(this, i, sock, to);
            content = await buildTextContent(text, mentions);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'image': {
            const media = await resolveMedia(this, i, items);
            const caption = this.getNodeParameter('caption', i, '') as string;
            const mentions = await resolveMentions(this, i, sock, to);
            content = await buildImageContent(media, caption || undefined, mentions);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'video': {
            const media = await resolveMedia(this, i, items);
            const caption = this.getNodeParameter('caption', i, '') as string;
            const mentions = await resolveMentions(this, i, sock, to);
            content = await buildVideoContent(media, caption || undefined, mentions);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'audio': {
            const media = await resolveMedia(this, i, items);
            content = await buildAudioContent(media, false);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'voiceNote': {
            const media = await resolveMedia(this, i, items);
            content = await buildAudioContent(media, true);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'document': {
            const media = await resolveMedia(this, i, items);
            const fileName = this.getNodeParameter('fileName', i, '') as string;
            content = await buildDocumentContent(media, fileName || undefined);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'sticker': {
            const media = await resolveMedia(this, i, items);
            const resolved = media.type === 'url' ? { url: media.data as string } : (media.data as Buffer);
            sent = await sock.sendMessage(to, { sticker: resolved });
            break;
          }

          case 'location': {
            const lat = this.getNodeParameter('latitude', i) as number;
            const lon = this.getNodeParameter('longitude', i) as number;
            const name = this.getNodeParameter('locationName', i, '') as string;
            const address = this.getNodeParameter('locationAddress', i, '') as string;
            content = await buildLocationContent(lat, lon, name || undefined, address || undefined);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'contact': {
            const displayName = this.getNodeParameter('contactDisplayName', i) as string;
            const vcard = this.getNodeParameter('vcard', i) as string;
            content = buildContactContent(displayName, vcard);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'poll': {
            const pollName = this.getNodeParameter('pollName', i) as string;
            const optionsStr = this.getNodeParameter('pollOptions', i) as string;
            const values = optionsStr.split(',').map(s => s.trim()).filter(Boolean);
            const selectable = this.getNodeParameter('pollSelectable', i, 1) as number;
            content = buildPollContent(pollName, values, selectable);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'reaction': {
            const emoji = this.getNodeParameter('reactionEmoji', i, '') as string;
            const msgId = this.getNodeParameter('targetMessageId', i) as string;
            const msgJid = this.getNodeParameter('targetMessageJid', i) as string;
            const fromMe = this.getNodeParameter('targetFromMe', i) as boolean;
            content = buildReactionContent(emoji, { id: msgId, remoteJid: msgJid, fromMe });
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'buttons': {
            const body = this.getNodeParameter('buttonBody', i) as string;
            const footer = this.getNodeParameter('footer', i, '') as string;
            const rawButtons = (this.getNodeParameter('buttons', i, {}) as { button?: Array<{ id: string; label: string }> }).button ?? [];
            content = buildButtonsContent(body, rawButtons, footer || undefined);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'list': {
            const body = this.getNodeParameter('listBody', i) as string;
            const buttonText = this.getNodeParameter('listButtonText', i) as string;
            const title = this.getNodeParameter('listTitle', i, '') as string;
            const footer = this.getNodeParameter('footer', i, '') as string;
            const sectionsJson = this.getNodeParameter('listSectionsJson', i) as string;
            const sections = JSON.parse(sectionsJson);
            content = buildListContent(body, buttonText, sections, title || undefined, footer || undefined);
            sent = await sendMessage(sock, to, content);
            break;
          }

          case 'editMessage': {
            const text = this.getNodeParameter('text', i) as string;
            const msgId = this.getNodeParameter('targetMessageId', i) as string;
            const msgJid = this.getNodeParameter('targetMessageJid', i) as string;
            const fromMe = this.getNodeParameter('targetFromMe', i) as boolean;
            sent = await sock.sendMessage(to, {
              edit: { id: msgId, remoteJid: msgJid, fromMe },
              text,
            });
            break;
          }

          case 'forward': {
            const msgId = this.getNodeParameter('targetMessageId', i) as string;
            const fromMe = this.getNodeParameter('targetFromMe', i) as boolean;
            const forwardTo = normaliseJid(this.getNodeParameter('forwardTo', i) as string);
            const msg: WAMessage = { key: { id: msgId, remoteJid: to, fromMe } };
            await sock.sendMessage(forwardTo, { forward: msg });
            sent = { key: { id: 'forwarded' } };
            break;
          }

          default:
            throw new Error(`Unknown operation: ${operation}`);
        }

        returnData.push({
          json: {
            success: true,
            operation,
            to,
            backend: backendId,
            messageId: sent?.key?.id ?? null,
            timestamp: sent?.messageTimestamp ?? Date.now(),
          },
        });
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

async function resolveMentions(
  ctx: IExecuteFunctions,
  i: number,
  sock: Parameters<typeof GroupHelpers.getGroupMetadata>[0],
  to: string,
): Promise<string[] | undefined> {
  const explicitStr = ctx.getNodeParameter('mentionUsers', i, '') as string;
  const mentionAll = ctx.getNodeParameter('mentionAll', i, false) as boolean;

  const explicit = explicitStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normaliseJid);

  let all: string[] = [];
  if (mentionAll && to.endsWith('@g.us')) {
    try {
      const metadata = (await GroupHelpers.getGroupMetadata(sock, to)) as {
        participants?: Array<{ id: string }>;
      };
      all = (metadata.participants ?? [])
        .filter(p => p?.id)
        .map(p => p.id);
    } catch {
      // Non-fatal: fall back to just the explicit list if metadata fetch fails.
    }
  }

  const merged = Array.from(new Set([...explicit, ...all]));
  return merged.length ? merged : undefined;
}

async function resolveMedia(
  ctx: IExecuteFunctions,
  i: number,
  items: INodeExecutionData[],
): Promise<MediaInput> {
  const source = ctx.getNodeParameter('mediaSource', i, 'url') as string;

  if (source === 'url') {
    const url = ctx.getNodeParameter('mediaUrl', i) as string;
    return { type: 'url', data: url };
  }

  if (source === 'binary') {
    const prop = ctx.getNodeParameter('binaryPropertyName', i, 'data') as string;
    const binaryData = items[i].binary?.[prop];
    if (!binaryData) throw new Error(`No binary data found in property "${prop}"`);
    const buf = await ctx.helpers.getBinaryDataBuffer(i, prop);
    return { type: 'binary', data: buf, mimeType: binaryData.mimeType, filename: binaryData.fileName };
  }

  if (source === 'base64') {
    const b64 = ctx.getNodeParameter('base64Data', i) as string;
    return { type: 'base64', data: b64 };
  }

  if (source === 'path') {
    const p = ctx.getNodeParameter('filePath', i) as string;
    return { type: 'path', data: p };
  }

  throw new Error(`Unknown media source: ${source}`);
}

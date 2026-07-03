import { resolveMediaBuffer } from './Utils';
import type { MediaInput } from './Types';
import type { WAClientSocket as WASocket } from './backends/SocketInterface';

// `AnyMessageContent` / `WAMessage` are structural, backend-agnostic
// stand-ins for the SDK-specific types of the same name in anya-bail /
// baileys. Both SDKs accept/return objects with this shape, so keeping
// this file decoupled from either SDK's type declarations lets it work
// unmodified against whichever backend produced the socket.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMessageContent = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WAMessage = Record<string, any>;

export async function buildTextContent(text: string, mentions?: string[]): Promise<AnyMessageContent> {
  return mentions?.length ? { text, mentions } : { text };
}

export async function buildImageContent(
  media: MediaInput,
  caption?: string,
  mentions?: string[],
): Promise<AnyMessageContent> {
  const resolved = await resolveMediaBuffer(media.type, media.data);
  const imageSource = Buffer.isBuffer(resolved) ? { image: resolved } : { image: resolved };
  return { ...imageSource, caption, ...(mentions?.length ? { mentions } : {}) } as AnyMessageContent;
}

export async function buildVideoContent(
  media: MediaInput,
  caption?: string,
  mentions?: string[],
): Promise<AnyMessageContent> {
  const resolved = await resolveMediaBuffer(media.type, media.data);
  return { video: resolved as Buffer, caption, ...(mentions?.length ? { mentions } : {}) } as AnyMessageContent;
}

export async function buildAudioContent(
  media: MediaInput,
  ptt = false,
): Promise<AnyMessageContent> {
  const resolved = await resolveMediaBuffer(media.type, media.data);
  return {
    audio: resolved as Buffer,
    mimetype: media.mimeType ?? 'audio/mp4',
    ptt,
  } as AnyMessageContent;
}

export async function buildDocumentContent(
  media: MediaInput,
  filename?: string,
): Promise<AnyMessageContent> {
  const resolved = await resolveMediaBuffer(media.type, media.data);
  return {
    document: resolved as Buffer,
    mimetype: media.mimeType ?? 'application/octet-stream',
    fileName: filename ?? media.filename ?? 'file',
  } as AnyMessageContent;
}

export async function buildLocationContent(
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
): Promise<AnyMessageContent> {
  return {
    location: { degreesLatitude: latitude, degreesLongitude: longitude, name, address },
  } as AnyMessageContent;
}

export function buildContactContent(
  displayName: string,
  vcard: string,
): AnyMessageContent {
  return {
    contacts: {
      displayName,
      contacts: [{ vcard }],
    },
  } as AnyMessageContent;
}

export function buildPollContent(
  name: string,
  values: string[],
  selectableCount = 1,
): AnyMessageContent {
  return {
    poll: { name, values, selectableCount },
  } as AnyMessageContent;
}

export function buildReactionContent(
  reactionText: string,
  targetKey: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null },
): AnyMessageContent {
  return { react: { text: reactionText, key: targetKey } } as AnyMessageContent;
}

export function buildButtonsContent(
  bodyText: string,
  buttons: Array<{ id: string; label: string }>,
  footer?: string,
): AnyMessageContent {
  return {
    buttons: buttons.map(b => ({
      buttonId: b.id,
      buttonText: { displayText: b.label },
      type: 1,
    })),
    text: bodyText,
    footer,
  } as AnyMessageContent;
}

export function buildListContent(
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  title?: string,
  footer?: string,
): AnyMessageContent {
  return {
    text: bodyText,
    title,
    footer,
    buttonText,
    sections: sections.map(s => ({
      title: s.title,
      rows: s.rows.map(r => ({ rowId: r.id, title: r.title, description: r.description })),
    })),
  } as AnyMessageContent;
}

export async function sendMessage(
  sock: WASocket,
  jid: string,
  content: AnyMessageContent,
  quotedMsg?: WAMessage,
): Promise<WAMessage | undefined> {
  return sock.sendMessage(jid, content, quotedMsg ? { quoted: quotedMsg } : undefined);
}

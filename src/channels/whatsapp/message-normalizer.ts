import { randomUUID } from 'node:crypto';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import type { UserMessage, UserMessageType } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('MessageNormalizer');

export interface NormalizerResult {
  message: UserMessage;
  rawJid: string;
}

/**
 * Converts a Baileys WAMessage into the internal UserMessage format.
 * Returns null if the message should be skipped (e.g. status broadcasts, protocol messages).
 */
export async function normalizeMessage(
  waMessage: WAMessage,
  channelId: string,
): Promise<NormalizerResult | null> {
  const jid = waMessage.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return null;

  const msg = waMessage.message;
  if (!msg) return null;

  const senderId = jid;
  const baseMessage = {
    id: waMessage.key.id || randomUUID(),
    timestamp: (waMessage.messageTimestamp as number) * 1000 || Date.now(),
    channelId,
    senderId,
  };

  // Text message
  const textContent = msg.conversation || msg.extendedTextMessage?.text;
  if (textContent) {
    const replyTo = msg.extendedTextMessage?.contextInfo?.stanzaId;
    return {
      message: {
        ...baseMessage,
        type: 'text' as UserMessageType,
        content: textContent,
        replyTo: replyTo || undefined,
        metadata: {
          conversationId: jid,
          pushName: waMessage.pushName,
        },
      },
      rawJid: jid,
    };
  }

  // Image message
  if (msg.imageMessage) {
    let attachment: string | undefined;
    try {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      attachment = (buffer as Buffer).toString('base64');
    } catch (err) {
      logger.warn({ err, messageId: waMessage.key.id }, 'Failed to download image');
    }

    return {
      message: {
        ...baseMessage,
        type: 'image' as UserMessageType,
        content: msg.imageMessage.caption || '',
        attachment,
        metadata: {
          conversationId: jid,
          mimeType: msg.imageMessage.mimetype,
          pushName: waMessage.pushName,
        },
      },
      rawJid: jid,
    };
  }

  // Document message
  if (msg.documentMessage) {
    let attachment: string | undefined;
    try {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      attachment = (buffer as Buffer).toString('base64');
    } catch (err) {
      logger.warn({ err, messageId: waMessage.key.id }, 'Failed to download document');
    }

    return {
      message: {
        ...baseMessage,
        type: 'document' as UserMessageType,
        content: msg.documentMessage.fileName || 'document',
        attachment,
        metadata: {
          conversationId: jid,
          mimeType: msg.documentMessage.mimetype,
          fileName: msg.documentMessage.fileName,
          pushName: waMessage.pushName,
        },
      },
      rawJid: jid,
    };
  }

  // Audio / voice message
  if (msg.audioMessage) {
    let attachment: string | undefined;
    try {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      attachment = (buffer as Buffer).toString('base64');
    } catch (err) {
      logger.warn({ err, messageId: waMessage.key.id }, 'Failed to download audio');
    }

    return {
      message: {
        ...baseMessage,
        type: 'audio' as UserMessageType,
        content: '[voice message]',
        attachment,
        metadata: {
          conversationId: jid,
          mimeType: msg.audioMessage.mimetype,
          seconds: msg.audioMessage.seconds,
          ptt: msg.audioMessage.ptt, // push-to-talk = voice note
          pushName: waMessage.pushName,
        },
      },
      rawJid: jid,
    };
  }

  // Reaction message
  if (msg.reactionMessage) {
    return {
      message: {
        ...baseMessage,
        type: 'reaction' as UserMessageType,
        content: msg.reactionMessage.text || '',
        replyTo: msg.reactionMessage.key?.id || undefined,
        metadata: {
          conversationId: jid,
          pushName: waMessage.pushName,
        },
      },
      rawJid: jid,
    };
  }

  logger.debug(
    { messageId: waMessage.key.id, keys: Object.keys(msg) },
    'Unsupported message type — skipping',
  );
  return null;
}

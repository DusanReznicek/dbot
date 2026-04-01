import { randomUUID } from 'node:crypto';
import type { Api } from 'grammy';
import type { Message } from 'grammy/types';
import type { UserMessage, UserMessageType } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('TelegramNormalizer');

export interface NormalizerResult {
  message: UserMessage;
  rawChatId: number;
}

/**
 * Downloads a Telegram file by file_id and returns its base64 content.
 */
async function downloadFile(api: Api, fileId: string): Promise<string | undefined> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return undefined;

    const url = `https://api.telegram.org/file/bot${(api as any).token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) return undefined;

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  } catch (err) {
    logger.warn({ err, fileId }, 'Failed to download Telegram file');
    return undefined;
  }
}

/**
 * Converts a Telegram Message into the internal UserMessage format.
 * Returns null if the message should be skipped.
 */
export async function normalizeMessage(
  msg: Message,
  channelId: string,
  api: Api,
): Promise<NormalizerResult | null> {
  // Skip messages without a sender (channel posts)
  if (!msg.from) return null;

  const chatId = msg.chat.id;
  const senderId = String(msg.from.id);
  const pushName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');

  const baseMessage = {
    id: String(msg.message_id),
    timestamp: msg.date * 1000,
    channelId,
    senderId,
  };

  const replyTo = msg.reply_to_message?.message_id?.toString();

  // Text message
  if (msg.text) {
    return {
      message: {
        ...baseMessage,
        type: 'text' as UserMessageType,
        content: msg.text,
        replyTo,
        metadata: {
          conversationId: String(chatId),
          pushName,
        },
      },
      rawChatId: chatId,
    };
  }

  // Photo message (pick largest resolution)
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    const attachment = await downloadFile(api, largest.file_id);

    return {
      message: {
        ...baseMessage,
        type: 'image' as UserMessageType,
        content: msg.caption || '',
        attachment,
        replyTo,
        metadata: {
          conversationId: String(chatId),
          pushName,
        },
      },
      rawChatId: chatId,
    };
  }

  // Document message
  if (msg.document) {
    const attachment = await downloadFile(api, msg.document.file_id);

    return {
      message: {
        ...baseMessage,
        type: 'document' as UserMessageType,
        content: msg.document.file_name || 'document',
        attachment,
        replyTo,
        metadata: {
          conversationId: String(chatId),
          mimeType: msg.document.mime_type,
          fileName: msg.document.file_name,
          pushName,
        },
      },
      rawChatId: chatId,
    };
  }

  // Audio / voice message
  if (msg.audio || msg.voice) {
    const audio = msg.audio || msg.voice;
    const attachment = audio ? await downloadFile(api, audio.file_id) : undefined;

    return {
      message: {
        ...baseMessage,
        type: 'audio' as UserMessageType,
        content: '[voice message]',
        attachment,
        replyTo,
        metadata: {
          conversationId: String(chatId),
          mimeType: audio?.mime_type,
          duration: audio?.duration,
          pushName,
        },
      },
      rawChatId: chatId,
    };
  }

  logger.debug(
    { messageId: msg.message_id, chatId },
    'Unsupported Telegram message type — skipping',
  );
  return null;
}

import type { Api } from 'grammy';
import { InputFile } from 'grammy';
import type { AgentResponse } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('TelegramFormatter');

const DEFAULT_MAX_LENGTH = 4096;

export interface FormatterOptions {
  maxMessageLength: number;
  typingIndicator: boolean;
}

/**
 * Formats an AgentResponse into Telegram messages and sends them.
 */
export async function sendFormattedResponse(
  api: Api,
  chatId: number,
  response: AgentResponse,
  options: FormatterOptions,
): Promise<void> {
  // Show typing indicator
  if (options.typingIndicator) {
    try {
      await api.sendChatAction(chatId, 'typing');
    } catch {
      // Non-critical
    }
  }

  // Send image if present
  if (response.image) {
    try {
      const file = new InputFile(Buffer.from(response.image, 'base64'), 'image.jpg');
      await api.sendPhoto(chatId, file, {
        caption: response.text || undefined,
      });
      // If image has caption, we're done — text was included as caption
      if (response.text) return;
    } catch (err) {
      logger.error({ err, chatId }, 'Failed to send image — falling back to text');
    }
  }

  // Send document if present
  if (response.document) {
    try {
      const file = new InputFile(
        Buffer.from(response.document.data, 'base64'),
        response.document.fileName,
      );
      await api.sendDocument(chatId, file);
    } catch (err) {
      logger.error({ err, chatId }, 'Failed to send document');
    }
  }

  // Send text — chunk if necessary
  if (response.text) {
    const chunks = chunkText(response.text, options.maxMessageLength || DEFAULT_MAX_LENGTH);

    for (const chunk of chunks) {
      try {
        // Try Markdown first, fall back to plain text
        await api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      } catch {
        try {
          await api.sendMessage(chatId, chunk);
        } catch (err) {
          logger.error({ err, chatId }, 'Failed to send text message');
        }
      }
    }
  }
}

/**
 * Splits text into chunks that respect Telegram's max message length.
 * Tries to break at line boundaries; falls back to hard break.
 */
export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a line break near the limit
    let breakIndex = remaining.lastIndexOf('\n', maxLength);
    if (breakIndex <= 0 || breakIndex < maxLength * 0.5) {
      // Try space break
      breakIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakIndex <= 0 || breakIndex < maxLength * 0.5) {
      // Hard break at limit
      breakIndex = maxLength;
    }

    chunks.push(remaining.slice(0, breakIndex));
    remaining = remaining.slice(breakIndex).trimStart();
  }

  return chunks;
}

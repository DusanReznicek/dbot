import type { WASocket } from '@whiskeysockets/baileys';
import type { AgentResponse } from '../../core/interfaces/message.interface.js';
import { createLogger } from '../../core/utils/logger.js';

const logger = createLogger('ResponseFormatter');

const DEFAULT_MAX_LENGTH = 4096;

export interface FormatterOptions {
  maxMessageLength: number;
  typingIndicator: boolean;
  readMessages: boolean;
}

/**
 * Formats an AgentResponse into WhatsApp messages and sends them.
 */
export async function sendFormattedResponse(
  socket: WASocket,
  jid: string,
  response: AgentResponse,
  options: FormatterOptions,
): Promise<void> {
  // Read receipt for the original message
  if (options.readMessages) {
    try {
      await socket.readMessages([{ remoteJid: jid, id: response.metadata?.originalMessageId as string }]);
    } catch {
      // Non-critical — ignore read receipt failures
    }
  }

  // Show typing indicator
  if (options.typingIndicator) {
    try {
      await socket.sendPresenceUpdate('composing', jid);
    } catch {
      // Non-critical
    }
  }

  // Send image if present
  if (response.image) {
    try {
      await socket.sendMessage(jid, {
        image: Buffer.from(response.image, 'base64'),
        caption: response.text || undefined,
      });
      // If image has caption, we're done — text was included as caption
      if (response.text) {
        await clearTyping(socket, jid, options);
        return;
      }
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send image — falling back to text');
    }
  }

  // Send document if present
  if (response.document) {
    try {
      await socket.sendMessage(jid, {
        document: Buffer.from(response.document.data, 'base64'),
        fileName: response.document.fileName,
        mimetype: response.document.mimeType,
      });
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send document');
    }
  }

  // Send text — chunk if necessary
  if (response.text) {
    const chunks = chunkText(response.text, options.maxMessageLength || DEFAULT_MAX_LENGTH);

    for (const chunk of chunks) {
      await socket.sendMessage(jid, { text: chunk });
    }
  }

  await clearTyping(socket, jid, options);
}

async function clearTyping(socket: WASocket, jid: string, options: FormatterOptions): Promise<void> {
  if (options.typingIndicator) {
    try {
      await socket.sendPresenceUpdate('paused', jid);
    } catch {
      // Non-critical
    }
  }
}

/**
 * Splits text into chunks that respect WhatsApp's max message length.
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

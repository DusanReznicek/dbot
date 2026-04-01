import { describe, it, expect, vi } from 'vitest';
import { normalizeMessage } from '../../../src/channels/whatsapp/message-normalizer.js';

// Mock downloadMediaMessage to avoid actual network calls
vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>();
  return {
    ...actual,
    downloadMediaMessage: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
  };
});

function createWAMessage(overrides: Record<string, unknown> = {}): any {
  return {
    key: {
      remoteJid: '420123456789@s.whatsapp.net',
      id: 'msg-001',
      fromMe: false,
      ...(overrides.key as Record<string, unknown> || {}),
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Test User',
    message: overrides.message || { conversation: 'Hello bot' },
  };
}

describe('MessageNormalizer', () => {
  const channelId = 'whatsapp';

  it('normalizes a text conversation message', async () => {
    const wa = createWAMessage({ message: { conversation: 'Ahoj bote' } });
    const result = await normalizeMessage(wa, channelId);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('text');
    expect(result!.message.content).toBe('Ahoj bote');
    expect(result!.message.channelId).toBe(channelId);
    expect(result!.message.senderId).toBe('420123456789@s.whatsapp.net');
    expect(result!.rawJid).toBe('420123456789@s.whatsapp.net');
  });

  it('normalizes an extendedText message with reply', async () => {
    const wa = createWAMessage({
      message: {
        extendedTextMessage: {
          text: 'Reply text',
          contextInfo: { stanzaId: 'original-msg-id' },
        },
      },
    });
    const result = await normalizeMessage(wa, channelId);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('text');
    expect(result!.message.content).toBe('Reply text');
    expect(result!.message.replyTo).toBe('original-msg-id');
  });

  it('normalizes an image message with caption', async () => {
    const wa = createWAMessage({
      message: {
        imageMessage: {
          caption: 'Check this out',
          mimetype: 'image/jpeg',
        },
      },
    });
    const result = await normalizeMessage(wa, channelId);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('image');
    expect(result!.message.content).toBe('Check this out');
    expect(result!.message.attachment).toBeDefined();
    expect(result!.message.metadata?.mimeType).toBe('image/jpeg');
  });

  it('normalizes a document message', async () => {
    const wa = createWAMessage({
      message: {
        documentMessage: {
          fileName: 'report.pdf',
          mimetype: 'application/pdf',
        },
      },
    });
    const result = await normalizeMessage(wa, channelId);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('document');
    expect(result!.message.content).toBe('report.pdf');
    expect(result!.message.metadata?.fileName).toBe('report.pdf');
  });

  it('normalizes an audio/voice message', async () => {
    const wa = createWAMessage({
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 5,
          ptt: true,
        },
      },
    });
    const result = await normalizeMessage(wa, channelId);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('audio');
    expect(result!.message.content).toBe('[voice message]');
    expect(result!.message.metadata?.ptt).toBe(true);
    expect(result!.message.metadata?.seconds).toBe(5);
  });

  it('normalizes a reaction message', async () => {
    const wa = createWAMessage({
      message: {
        reactionMessage: {
          text: '👍',
          key: { id: 'reacted-msg-id' },
        },
      },
    });
    const result = await normalizeMessage(wa, channelId);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('reaction');
    expect(result!.message.content).toBe('👍');
    expect(result!.message.replyTo).toBe('reacted-msg-id');
  });

  it('returns null for status@broadcast', async () => {
    const wa = createWAMessage({
      key: { remoteJid: 'status@broadcast' },
      message: { conversation: 'status' },
    });
    const result = await normalizeMessage(wa, channelId);
    expect(result).toBeNull();
  });

  it('returns null for null message body', async () => {
    const wa = { key: { remoteJid: '420123@s.whatsapp.net', id: 'x' }, message: null };
    const result = await normalizeMessage(wa as any, channelId);
    expect(result).toBeNull();
  });

  it('returns null for unsupported message type', async () => {
    const wa = createWAMessage({ message: { stickerMessage: {} } });
    const result = await normalizeMessage(wa, channelId);
    expect(result).toBeNull();
  });
});

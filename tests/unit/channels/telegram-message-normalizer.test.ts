import { describe, it, expect, vi } from 'vitest';
import { normalizeMessage } from '../../../src/channels/telegram/message-normalizer.js';

function createMockApi(fileBuffer?: Buffer) {
  return {
    token: 'test-token',
    getFile: vi.fn().mockResolvedValue({ file_path: 'photos/test.jpg' }),
  } as any;
}

function baseTelegramMessage(overrides: Record<string, any> = {}) {
  return {
    message_id: 42,
    date: 1700000000,
    chat: { id: 123456, type: 'private' },
    from: { id: 99, first_name: 'Dušan', last_name: 'Řezníček', is_bot: false },
    ...overrides,
  };
}

describe('Telegram MessageNormalizer', () => {
  it('normalizes a text message', async () => {
    const msg = baseTelegramMessage({ text: 'Hello DBot!' });
    const result = await normalizeMessage(msg, 'telegram', createMockApi());

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('text');
    expect(result!.message.content).toBe('Hello DBot!');
    expect(result!.message.senderId).toBe('99');
    expect(result!.message.channelId).toBe('telegram');
    expect(result!.message.id).toBe('42');
    expect(result!.message.timestamp).toBe(1700000000000);
    expect(result!.message.metadata?.pushName).toBe('Dušan Řezníček');
    expect(result!.message.metadata?.conversationId).toBe('123456');
    expect(result!.rawChatId).toBe(123456);
  });

  it('normalizes a text message with reply', async () => {
    const msg = baseTelegramMessage({
      text: 'Yes, that one',
      reply_to_message: { message_id: 41 },
    });
    const result = await normalizeMessage(msg, 'telegram', createMockApi());

    expect(result).not.toBeNull();
    expect(result!.message.replyTo).toBe('41');
  });

  it('normalizes a photo message with caption', async () => {
    const msg = baseTelegramMessage({
      caption: 'Check this out',
      photo: [
        { file_id: 'small', file_unique_id: 's1', width: 100, height: 100 },
        { file_id: 'large', file_unique_id: 's2', width: 800, height: 600 },
      ],
    });

    // Mock fetch for file download
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }) as any;

    const api = createMockApi();
    const result = await normalizeMessage(msg, 'telegram', api);

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('image');
    expect(result!.message.content).toBe('Check this out');
    expect(result!.message.attachment).toBeDefined();
    // Should request the largest photo
    expect(api.getFile).toHaveBeenCalledWith('large');

    global.fetch = originalFetch;
  });

  it('normalizes a document message', async () => {
    const msg = baseTelegramMessage({
      document: {
        file_id: 'doc1',
        file_unique_id: 'd1',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }) as any;

    const result = await normalizeMessage(msg, 'telegram', createMockApi());

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('document');
    expect(result!.message.content).toBe('report.pdf');
    expect(result!.message.metadata?.mimeType).toBe('application/pdf');

    global.fetch = originalFetch;
  });

  it('normalizes a voice message', async () => {
    const msg = baseTelegramMessage({
      voice: {
        file_id: 'voice1',
        file_unique_id: 'v1',
        duration: 5,
        mime_type: 'audio/ogg',
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }) as any;

    const result = await normalizeMessage(msg, 'telegram', createMockApi());

    expect(result).not.toBeNull();
    expect(result!.message.type).toBe('audio');
    expect(result!.message.content).toBe('[voice message]');
    expect(result!.message.metadata?.duration).toBe(5);

    global.fetch = originalFetch;
  });

  it('returns null for messages without from (channel posts)', async () => {
    const msg = {
      message_id: 42,
      date: 1700000000,
      chat: { id: -100123, type: 'channel' },
      text: 'Channel post',
      // no from field
    };
    const result = await normalizeMessage(msg as any, 'telegram', createMockApi());
    expect(result).toBeNull();
  });

  it('returns null for unsupported types (sticker)', async () => {
    const msg = baseTelegramMessage({
      sticker: { file_id: 'stk1', file_unique_id: 'u1', width: 512, height: 512, is_animated: false, is_video: false, type: 'regular' },
    });
    const result = await normalizeMessage(msg, 'telegram', createMockApi());
    expect(result).toBeNull();
  });
});

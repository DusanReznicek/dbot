import { describe, it, expect, vi } from 'vitest';
import { chunkText, sendFormattedResponse } from '../../../src/channels/telegram/response-formatter.js';
import type { AgentResponse } from '../../../src/core/interfaces/message.interface.js';

function createMockApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({}),
    sendPhoto: vi.fn().mockResolvedValue({}),
    sendDocument: vi.fn().mockResolvedValue({}),
    sendChatAction: vi.fn().mockResolvedValue({}),
  } as any;
}

function createResponse(text: string, overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    id: 'resp-1',
    timestamp: Date.now(),
    agentId: 'test-agent',
    conversationId: 'conv-1',
    text,
    ...overrides,
  };
}

describe('Telegram ResponseFormatter', () => {
  describe('chunkText', () => {
    it('returns single chunk for short text', () => {
      expect(chunkText('Hello', 4096)).toEqual(['Hello']);
    });

    it('splits long text into chunks', () => {
      const text = 'A'.repeat(5000);
      const chunks = chunkText(text, 4096);
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(4096);
      expect(chunks[1].length).toBe(904);
    });

    it('breaks at newline when possible', () => {
      const text = 'A'.repeat(3000) + '\n' + 'B'.repeat(3000);
      const chunks = chunkText(text, 4096);
      expect(chunks[0]).toBe('A'.repeat(3000));
      expect(chunks[1]).toBe('B'.repeat(3000));
    });

    it('breaks at space when no newline available', () => {
      const text = 'A'.repeat(3000) + ' ' + 'B'.repeat(3000);
      const chunks = chunkText(text, 4096);
      expect(chunks[0]).toBe('A'.repeat(3000));
      expect(chunks[1]).toBe('B'.repeat(3000));
    });

    it('does hard break when no good break point', () => {
      const text = 'A'.repeat(8192);
      const chunks = chunkText(text, 4096);
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(4096);
    });

    it('handles empty string', () => {
      expect(chunkText('', 4096)).toEqual(['']);
    });
  });

  describe('sendFormattedResponse', () => {
    const options = { maxMessageLength: 4096, typingIndicator: true };

    it('sends typing action and text message', async () => {
      const api = createMockApi();
      await sendFormattedResponse(api, 123, createResponse('Hello!'), options);

      expect(api.sendChatAction).toHaveBeenCalledWith(123, 'typing');
      expect(api.sendMessage).toHaveBeenCalledWith(123, 'Hello!', { parse_mode: 'Markdown' });
    });

    it('sends photo with caption', async () => {
      const api = createMockApi();
      const response = createResponse('Caption text', {
        image: Buffer.from('fake-image').toString('base64'),
      });
      await sendFormattedResponse(api, 123, response, options);

      expect(api.sendPhoto).toHaveBeenCalled();
      // Text should not be sent separately (caption covers it)
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it('skips typing when disabled', async () => {
      const api = createMockApi();
      await sendFormattedResponse(api, 123, createResponse('Hi'), {
        maxMessageLength: 4096,
        typingIndicator: false,
      });

      expect(api.sendChatAction).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalled();
    });

    it('falls back to plain text when Markdown fails', async () => {
      const api = createMockApi();
      api.sendMessage
        .mockRejectedValueOnce(new Error('Markdown parse error'))
        .mockResolvedValueOnce({});

      await sendFormattedResponse(api, 123, createResponse('_broken markdown'), options);

      expect(api.sendMessage).toHaveBeenCalledTimes(2);
      // Second call should be without parse_mode
      expect(api.sendMessage).toHaveBeenLastCalledWith(123, '_broken markdown');
    });
  });
});

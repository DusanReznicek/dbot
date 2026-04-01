import { describe, it, expect } from 'vitest';
import { chunkText } from '../../../src/channels/whatsapp/response-formatter.js';

describe('ResponseFormatter', () => {
  describe('chunkText', () => {
    it('returns single chunk for short text', () => {
      const result = chunkText('Hello world', 4096);
      expect(result).toEqual(['Hello world']);
    });

    it('returns single chunk when text equals max length', () => {
      const text = 'a'.repeat(4096);
      const result = chunkText(text, 4096);
      expect(result).toEqual([text]);
    });

    it('splits at line break near the limit', () => {
      const line1 = 'a'.repeat(3000);
      const line2 = 'b'.repeat(2000);
      const text = `${line1}\n${line2}`;
      const result = chunkText(text, 4096);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(line1);
      expect(result[1]).toBe(line2);
    });

    it('splits at space when no line break available', () => {
      const words = Array(100).fill('longword').join(' ');
      const result = chunkText(words, 50);

      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(50);
      }
      // All words should be preserved
      expect(result.join(' ')).toBe(words);
    });

    it('hard breaks when no space or newline found', () => {
      const text = 'x'.repeat(10000);
      const result = chunkText(text, 4096);

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].length).toBe(4096);
    });

    it('handles empty string', () => {
      const result = chunkText('', 4096);
      expect(result).toEqual(['']);
    });

    it('preserves multiple line chunks correctly', () => {
      const lines = Array(10).fill('a'.repeat(500)).join('\n');
      const result = chunkText(lines, 2048);

      // Rejoin should contain all content
      const rejoined = result.join('\n');
      expect(rejoined.replace(/\n/g, '').length).toBe(lines.replace(/\n/g, '').length);
    });
  });
});

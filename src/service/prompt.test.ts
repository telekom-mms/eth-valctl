import { describe, expect, it } from 'bun:test';
import Prompts from 'prompts';

import { promptSecret } from './prompt';

describe('Prompt Service', () => {
  describe('promptSecret', () => {
    it('returns secret value when user provides input', async () => {
      Prompts.inject(['my-secret-key']);

      const result = await promptSecret('Enter secret:');

      expect(result).toBe('my-secret-key');
    });

    it('returns empty string when user provides empty input', async () => {
      Prompts.inject(['']);

      const result = await promptSecret('Enter secret:');

      expect(result).toBe('');
    });

    it('returns complex secret with special characters', async () => {
      const complexSecret = 'aB3$%^&*()_+{}|:<>?~`-=[]\\;\',./';
      Prompts.inject([complexSecret]);

      const result = await promptSecret('Enter secret:');

      expect(result).toBe(complexSecret);
    });
  });
});
